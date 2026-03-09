import io
import time
import logging

import pyotp
import qrcode
import qrcode.image.svg
from fastapi import APIRouter, HTTPException, Depends, Response, Request
from pydantic import BaseModel

from backend.database import get_db
from backend.utils.rate_limit import limiter
from backend.utils.auth import (
    get_current_admin,
    decode_pending_2fa_token,
    create_token,
    encrypt_totp_secret,
    decrypt_totp_secret,
    COOKIE_NAME,
)


def _is_secure(request: Request) -> bool:
    if request.url.scheme == "https":
        return True
    return request.headers.get("x-forwarded-proto", "").lower() == "https"

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth/2fa", tags=["2fa"])


class VerifyCode(BaseModel):
    code: str


class Verify2FALogin(BaseModel):
    code: str


class DisableRequest(BaseModel):
    code: str


def _current_totp_window() -> int:
    """Return the current 30-second TOTP window as an integer."""
    return int(time.time()) // 30


def _check_totp_replay(db, username: str, current_window: int):
    """Check if the TOTP code has already been used in this window."""
    row = db.execute(
        "SELECT totp_last_used_at FROM users WHERE username = ?", (username,)
    ).fetchone()
    if row and row["totp_last_used_at"] is not None and row["totp_last_used_at"] == current_window:
        raise HTTPException(status_code=400, detail="Code already used. Wait for the next code.")


def _mark_totp_used(db, username: str, current_window: int):
    """Mark the current TOTP window as used."""
    db.execute(
        "UPDATE users SET totp_last_used_at = ? WHERE username = ?",
        (current_window, username),
    )


@router.get("/status")
def get_2fa_status(username: str = Depends(get_current_admin)):
    db = get_db()
    try:
        row = db.execute(
            "SELECT totp_enabled FROM users WHERE username = ?", (username,)
        ).fetchone()
    finally:
        db.close()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {"enabled": bool(row["totp_enabled"])}


@router.post("/setup")
def setup_2fa(username: str = Depends(get_current_admin)):
    secret = pyotp.random_base32()
    totp = pyotp.TOTP(secret)
    uri = totp.provisioning_uri(name=username, issuer_name="Truebuntu")

    # Generate QR code as SVG string (PathFill includes white background)
    img = qrcode.make(uri, image_factory=qrcode.image.svg.SvgPathFillImage)
    buf = io.BytesIO()
    img.save(buf)
    qr_svg = buf.getvalue().decode("utf-8")
    # Strip XML declaration — not needed for inline HTML and can break dangerouslySetInnerHTML
    if qr_svg.startswith("<?xml"):
        qr_svg = qr_svg.split("?>", 1)[-1].strip()

    # Store encrypted secret (not yet enabled)
    encrypted = encrypt_totp_secret(secret)
    db = get_db()
    try:
        db.execute(
            "UPDATE users SET totp_secret = ? WHERE username = ?",
            (encrypted, username),
        )
        db.commit()
    finally:
        db.close()

    return {"secret": secret, "qr_svg": qr_svg}


@router.post("/enable")
def enable_2fa(body: VerifyCode, username: str = Depends(get_current_admin)):
    db = get_db()
    try:
        row = db.execute(
            "SELECT totp_secret FROM users WHERE username = ?", (username,)
        ).fetchone()
        if not row or not row["totp_secret"]:
            raise HTTPException(status_code=400, detail="Run setup first")

        secret = decrypt_totp_secret(row["totp_secret"])
        totp = pyotp.TOTP(secret)
        if not totp.verify(body.code):
            raise HTTPException(status_code=400, detail="Invalid verification code")

        current_window = _current_totp_window()
        _check_totp_replay(db, username, current_window)

        db.execute(
            "UPDATE users SET totp_enabled = 1 WHERE username = ?", (username,)
        )
        _mark_totp_used(db, username, current_window)
        db.commit()
    finally:
        db.close()

    return {"message": "2FA enabled"}


@router.post("/disable")
def disable_2fa(body: DisableRequest, username: str = Depends(get_current_admin)):
    db = get_db()
    try:
        row = db.execute(
            "SELECT totp_secret FROM users WHERE username = ?", (username,)
        ).fetchone()
        if not row or not row["totp_secret"]:
            raise HTTPException(status_code=400, detail="2FA not configured")

        secret = decrypt_totp_secret(row["totp_secret"])
        totp = pyotp.TOTP(secret)
        if not totp.verify(body.code):
            raise HTTPException(status_code=400, detail="Invalid verification code")

        current_window = _current_totp_window()
        _check_totp_replay(db, username, current_window)

        db.execute(
            "UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_last_used_at = NULL WHERE username = ?",
            (username,),
        )
        db.commit()
    finally:
        db.close()

    return {"message": "2FA disabled"}


@router.post("/verify")
@limiter.limit("5/minute")
def verify_2fa_login(body: Verify2FALogin, request: Request, response: Response):
    """Step 2 of login: verify OTP code using pending token from cookie."""
    pending_token = request.cookies.get("nas_2fa_pending")
    if not pending_token:
        raise HTTPException(status_code=401, detail="No pending 2FA session")

    username = decode_pending_2fa_token(pending_token)
    if not username:
        raise HTTPException(status_code=401, detail="Invalid or expired pending token")

    db = get_db()
    try:
        row = db.execute(
            "SELECT totp_secret, is_admin, token_version FROM users WHERE username = ?", (username,)
        ).fetchone()
        if not row or not row["totp_secret"]:
            raise HTTPException(status_code=400, detail="2FA not configured")

        secret = decrypt_totp_secret(row["totp_secret"])
        totp = pyotp.TOTP(secret)
        if not totp.verify(body.code):
            raise HTTPException(status_code=401, detail="Invalid verification code")

        current_window = _current_totp_window()
        _check_totp_replay(db, username, current_window)
        _mark_totp_used(db, username, current_window)
        db.commit()
    finally:
        db.close()

    # Issue session cookie
    token = create_token(username, row["token_version"])
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="strict",
        secure=_is_secure(request),
        max_age=86400,
        path="/",
    )
    # Delete the pending 2FA cookie
    response.delete_cookie(key="nas_2fa_pending", path="/")
    logger.info(f"User '{username}' completed 2FA login")
    return {"message": "Logged in", "username": username, "is_admin": bool(row["is_admin"])}
