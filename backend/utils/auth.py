import os
import re
import logging
import hashlib
import base64
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from cryptography.fernet import Fernet
from fastapi import Request, HTTPException, status

logger = logging.getLogger(__name__)

SECRET_KEY = os.environ.get("SECRET_KEY", "")
if not SECRET_KEY or SECRET_KEY in ("dev-secret-key-change-in-production", "change-me-to-a-random-string"):
    raise RuntimeError("SECRET_KEY must be set to a secure random value in .env")
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 24
COOKIE_NAME = "nas_session"

# Fernet cipher for TOTP encryption at rest (Phase 3D)
_fernet_key = base64.urlsafe_b64encode(hashlib.sha256(SECRET_KEY.encode()).digest())
_fernet = Fernet(_fernet_key)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


def create_token(username: str, token_version: int = 0) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS)
    return jwt.encode(
        {"sub": username, "exp": expire, "ver": token_version},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


def decode_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except jwt.InvalidTokenError:
        return None


def create_pending_2fa_token(username: str) -> str:
    """Create a short-lived token for pending 2FA verification."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=5)
    return jwt.encode(
        {"sub": username, "exp": expire, "type": "2fa_pending"},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


def decode_pending_2fa_token(token: str) -> str | None:
    """Decode a pending 2FA token, validating the type claim."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "2fa_pending":
            return None
        return payload.get("sub")
    except jwt.InvalidTokenError:
        return None


def encrypt_totp_secret(secret: str) -> str:
    """Encrypt a TOTP secret for storage at rest."""
    return _fernet.encrypt(secret.encode()).decode()


def decrypt_totp_secret(encrypted: str) -> str:
    """Decrypt a TOTP secret from storage."""
    return _fernet.decrypt(encrypted.encode()).decode()


def get_current_user(request: Request) -> str:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session",
        )
    username = payload.get("sub")
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session",
        )
    token_ver = payload.get("ver", 0)

    # Verify user still exists and token_version matches
    from backend.database import get_db
    db = get_db()
    try:
        row = db.execute(
            "SELECT token_version FROM users WHERE username = ?", (username,)
        ).fetchone()
        if not row:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User no longer exists",
            )
        if row["token_version"] != token_ver:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session has been revoked",
            )
    finally:
        db.close()

    return username


def get_current_admin(request: Request) -> str:
    username = get_current_user(request)
    from backend.database import get_db
    db = get_db()
    try:
        row = db.execute(
            "SELECT is_admin FROM users WHERE username = ?", (username,)
        ).fetchone()
        if not row or not row["is_admin"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Admin access required",
            )
    finally:
        db.close()
    return username
