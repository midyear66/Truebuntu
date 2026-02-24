import io
import logging

import pyotp
import qrcode
import qrcode.image.svg
from fastapi import APIRouter, HTTPException, Depends, Response
from pydantic import BaseModel

from backend.database import get_db
from backend.utils.auth import (
    get_current_admin,
    create_pending_2fa_token,
    decode_pending_2fa_token,
    create_token,
    COOKIE_NAME,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth/2fa", tags=["2fa"])


class VerifyCode(BaseModel):
    code: str


class Verify2FALogin(BaseModel):
    pending_token: str
    code: str


class DisableRequest(BaseModel):
    code: str


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

    # Store secret (not yet enabled)
    db = get_db()
    try:
        db.execute(
            "UPDATE users SET totp_secret = ? WHERE username = ?",
            (secret, username),
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

        totp = pyotp.TOTP(row["totp_secret"])
        if not totp.verify(body.code):
            raise HTTPException(status_code=400, detail="Invalid verification code")

        db.execute(
            "UPDATE users SET totp_enabled = 1 WHERE username = ?", (username,)
        )
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

        totp = pyotp.TOTP(row["totp_secret"])
        if not totp.verify(body.code):
            raise HTTPException(status_code=400, detail="Invalid verification code")

        db.execute(
            "UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE username = ?",
            (username,),
        )
        db.commit()
    finally:
        db.close()

    return {"message": "2FA disabled"}


@router.post("/verify")
def verify_2fa_login(body: Verify2FALogin, response: Response):
    """Step 2 of login: verify OTP code using pending token."""
    username = decode_pending_2fa_token(body.pending_token)
    if not username:
        raise HTTPException(status_code=401, detail="Invalid or expired pending token")

    db = get_db()
    try:
        row = db.execute(
            "SELECT totp_secret, is_admin FROM users WHERE username = ?", (username,)
        ).fetchone()
    finally:
        db.close()

    if not row or not row["totp_secret"]:
        raise HTTPException(status_code=400, detail="2FA not configured")

    totp = pyotp.TOTP(row["totp_secret"])
    if not totp.verify(body.code):
        raise HTTPException(status_code=401, detail="Invalid verification code")

    # Issue session cookie
    token = create_token(username)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="strict",
        path="/",
    )
    logger.info(f"User '{username}' completed 2FA login")
    return {"message": "Logged in", "username": username, "is_admin": bool(row["is_admin"])}
