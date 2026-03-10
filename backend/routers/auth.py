import re
import logging
import subprocess

from fastapi import APIRouter, HTTPException, Response, Depends, Request
from pydantic import BaseModel

from backend.database import get_db, admin_exists
from backend.utils.rate_limit import limiter
from backend.utils.shell import run
from backend.utils.auth import (
    hash_password,
    verify_password,
    create_token,
    create_pending_2fa_token,
    get_current_user,
    get_current_admin,
    COOKIE_NAME,
)


def _is_secure(request: Request) -> bool:
    """Determine if Secure flag should be set on cookies."""
    if request.url.scheme == "https":
        return True
    proto = request.headers.get("x-forwarded-proto", "")
    return proto.lower() == "https"

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])

VALID_APP_USERNAME = re.compile(r"^[a-zA-Z0-9_-]{2,32}$")


def _validate_password(password: str):
    """Require >= 8 chars, 1 uppercase, 1 lowercase, 1 digit."""
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if not re.search(r"[A-Z]", password):
        raise HTTPException(status_code=400, detail="Password must contain at least one uppercase letter")
    if not re.search(r"[a-z]", password):
        raise HTTPException(status_code=400, detail="Password must contain at least one lowercase letter")
    if not re.search(r"[0-9]", password):
        raise HTTPException(status_code=400, detail="Password must contain at least one digit")


class LoginRequest(BaseModel):
    username: str
    password: str


class SetupRequest(BaseModel):
    username: str
    password: str


@router.get("/setup-required")
def setup_required():
    return {"setup_required": not admin_exists()}


@router.post("/setup")
@limiter.limit("5/minute")
def setup(req: SetupRequest, request: Request, response: Response):
    if admin_exists():
        raise HTTPException(status_code=400, detail="Admin already exists")
    if not VALID_APP_USERNAME.match(req.username):
        raise HTTPException(status_code=400, detail="Username must be 2-32 alphanumeric characters, hyphens, or underscores")
    _validate_password(req.password)

    db = get_db()
    try:
        db.execute(
            "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)",
            (req.username, hash_password(req.password)),
        )
        db.commit()
        row = db.execute(
            "SELECT token_version FROM users WHERE username = ?", (req.username,)
        ).fetchone()
        token_version = row["token_version"] if row else 0
    finally:
        db.close()

    token = create_token(req.username, token_version)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="strict",
        secure=_is_secure(request),
        max_age=86400,
        path="/",
    )
    logger.info(f"Admin user '{req.username}' created via setup")
    return {"message": "Admin created", "username": req.username}


@router.post("/login")
@limiter.limit("5/minute")
def login(req: LoginRequest, request: Request, response: Response):
    db = get_db()
    try:
        row = db.execute(
            "SELECT username, password_hash, totp_enabled, is_admin, token_version FROM users WHERE username = ?",
            (req.username,),
        ).fetchone()
    finally:
        db.close()

    if not row or not verify_password(req.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Check if 2FA is enabled
    if row["totp_enabled"]:
        pending_token = create_pending_2fa_token(req.username)
        logger.info(f"User '{req.username}' requires 2FA verification")
        response.set_cookie(
            key="nas_2fa_pending",
            value=pending_token,
            httponly=True,
            samesite="strict",
            secure=_is_secure(request),
            max_age=300,
            path="/",
        )
        return {"requires_2fa": True}

    token = create_token(req.username, row["token_version"])
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="strict",
        secure=_is_secure(request),
        max_age=86400,
        path="/",
    )
    logger.info(f"User '{req.username}' logged in")
    return {"message": "Logged in", "username": req.username, "is_admin": bool(row["is_admin"])}


@router.post("/logout")
def logout(response: Response, username: str = Depends(get_current_user)):
    # Increment token_version to invalidate all existing tokens
    db = get_db()
    try:
        db.execute(
            "UPDATE users SET token_version = token_version + 1 WHERE username = ?",
            (username,),
        )
        db.commit()
    finally:
        db.close()
    response.delete_cookie(key=COOKIE_NAME, path="/")
    return {"message": "Logged out"}


ALLOWED_PREFERENCE_KEYS = {"dashboard-card-order"}


class PreferenceValue(BaseModel):
    value: str


@router.get("/preferences/{key}")
def get_preference(key: str, username: str = Depends(get_current_user)):
    if key not in ALLOWED_PREFERENCE_KEYS:
        raise HTTPException(status_code=400, detail="Invalid preference key")

    db = get_db()
    try:
        user = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        row = db.execute(
            "SELECT value FROM user_preferences WHERE user_id = ? AND key = ?",
            (user["id"], key),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Preference not set")
        return {"value": row["value"]}
    finally:
        db.close()


@router.put("/preferences/{key}")
def set_preference(key: str, req: PreferenceValue, username: str = Depends(get_current_user)):
    if key not in ALLOWED_PREFERENCE_KEYS:
        raise HTTPException(status_code=400, detail="Invalid preference key")

    db = get_db()
    try:
        user = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        db.execute(
            "INSERT OR REPLACE INTO user_preferences (user_id, key, value) VALUES (?, ?, ?)",
            (user["id"], key, req.value),
        )
        db.commit()
    finally:
        db.close()

    return {"message": "Saved"}


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password")
@limiter.limit("5/minute")
def change_password(req: ChangePasswordRequest, request: Request, username: str = Depends(get_current_user)):
    _validate_password(req.new_password)

    db = get_db()
    try:
        row = db.execute(
            "SELECT password_hash FROM users WHERE username = ?", (username,)
        ).fetchone()
        if not row or not verify_password(req.current_password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="Current password is incorrect")

        db.execute(
            "UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE username = ?",
            (hash_password(req.new_password), username),
        )
        db.commit()
    finally:
        db.close()

    logger.info(f"User '{username}' changed their password")
    return {"message": "Password changed successfully"}


@router.get("/me")
def me(username: str = Depends(get_current_user)):
    db = get_db()
    try:
        row = db.execute(
            "SELECT is_admin FROM users WHERE username = ?", (username,)
        ).fetchone()
    finally:
        db.close()
    return {"username": username, "is_admin": bool(row["is_admin"]) if row else False}


class AppUserCreateRequest(BaseModel):
    username: str
    password: str
    is_admin: bool = False
    create_smb_user: bool = False


class AppUserPasswordRequest(BaseModel):
    password: str


@router.get("/users")
def list_app_users(admin: str = Depends(get_current_admin)):
    db = get_db()
    try:
        rows = db.execute(
            "SELECT id, username, is_admin, created_at, totp_enabled FROM users"
        ).fetchall()
    finally:
        db.close()
    return [
        {
            "id": r["id"],
            "username": r["username"],
            "is_admin": bool(r["is_admin"]),
            "created_at": r["created_at"],
            "totp_enabled": bool(r["totp_enabled"]),
        }
        for r in rows
    ]


@router.post("/users")
def create_app_user(req: AppUserCreateRequest, admin: str = Depends(get_current_admin)):
    if not VALID_APP_USERNAME.match(req.username):
        raise HTTPException(status_code=400, detail="Username must be 2-32 alphanumeric characters, hyphens, or underscores")
    _validate_password(req.password)

    db = get_db()
    try:
        existing = db.execute(
            "SELECT id FROM users WHERE username = ?", (req.username,)
        ).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="Username already exists")
        db.execute(
            "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)",
            (req.username, hash_password(req.password), int(req.is_admin)),
        )
        db.commit()
    finally:
        db.close()

    smb_created = False
    smb_error = ""
    if req.create_smb_user:
        # Create system user (lowercase, sanitized)
        linux_name = re.sub(r"[^a-z0-9_-]", "_", req.username.lower())
        check = run(["getent", "passwd", linux_name])
        if check.ok:
            # System user already exists, just add SMB
            pass
        else:
            result = run(["useradd", "-m", linux_name])
            if not result.ok:
                smb_error = f"Failed to create system user: {result.stderr.strip()}"
        if not smb_error:
            # Set system password
            proc = subprocess.run(
                ["nsenter", "-t", "1", "-m", "-u", "-n", "-i", "chpasswd"],
                input=f"{linux_name}:{req.password}\n",
                capture_output=True, text=True, timeout=10,
            )
            # Create SMB user
            proc = subprocess.run(
                ["smbpasswd", "-a", "-s", linux_name],
                input=f"{req.password}\n{req.password}\n",
                capture_output=True, text=True, timeout=10,
            )
            if proc.returncode == 0:
                smb_created = True
            else:
                smb_error = f"Failed to create SMB user: {proc.stderr.strip()}"

    logger.info(f"Admin '{admin}' created app user '{req.username}'" +
                (f" with SMB user" if smb_created else ""))
    result = {"message": "User created", "username": req.username}
    if req.create_smb_user:
        result["smb_created"] = smb_created
        if smb_error:
            result["smb_error"] = smb_error
    return result


@router.delete("/users/{username}")
def delete_app_user(username: str, admin: str = Depends(get_current_admin)):
    if username == admin:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    db = get_db()
    try:
        row = db.execute(
            "SELECT is_admin FROM users WHERE username = ?", (username,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")

        if row["is_admin"]:
            count = db.execute(
                "SELECT COUNT(*) FROM users WHERE is_admin = 1"
            ).fetchone()[0]
            if count <= 1:
                raise HTTPException(status_code=400, detail="Cannot delete the last admin")

        db.execute("DELETE FROM users WHERE username = ?", (username,))
        db.commit()
    finally:
        db.close()

    logger.info(f"Admin '{admin}' deleted app user '{username}'")
    return {"message": "User deleted"}


@router.post("/users/{username}/password")
def reset_app_user_password(
    username: str, req: AppUserPasswordRequest, admin: str = Depends(get_current_admin)
):
    _validate_password(req.password)

    db = get_db()
    try:
        row = db.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")

        db.execute(
            "UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE username = ?",
            (hash_password(req.password), username),
        )
        db.commit()
    finally:
        db.close()

    logger.info(f"Admin '{admin}' reset password for app user '{username}'")
    return {"message": "Password reset successfully"}
