import logging

from fastapi import APIRouter, HTTPException, Response, Depends
from pydantic import BaseModel

from backend.database import get_db, admin_exists
from backend.utils.auth import (
    hash_password,
    verify_password,
    create_token,
    create_pending_2fa_token,
    get_current_user,
    get_current_admin,
    COOKIE_NAME,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])


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
def setup(req: SetupRequest, response: Response):
    if admin_exists():
        raise HTTPException(status_code=400, detail="Admin already exists")
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    db = get_db()
    try:
        db.execute(
            "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)",
            (req.username, hash_password(req.password)),
        )
        db.commit()
    finally:
        db.close()

    token = create_token(req.username)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="strict",
        path="/",
    )
    logger.info(f"Admin user '{req.username}' created via setup")
    return {"message": "Admin created", "username": req.username}


@router.post("/login")
def login(req: LoginRequest, response: Response):
    db = get_db()
    try:
        row = db.execute(
            "SELECT username, password_hash, totp_enabled, is_admin FROM users WHERE username = ?",
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
        return {"requires_2fa": True, "pending_token": pending_token}

    token = create_token(req.username)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="strict",
        path="/",
    )
    logger.info(f"User '{req.username}' logged in")
    return {"message": "Logged in", "username": req.username, "is_admin": bool(row["is_admin"])}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(key=COOKIE_NAME, path="/")
    return {"message": "Logged out"}


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password")
def change_password(req: ChangePasswordRequest, username: str = Depends(get_current_user)):
    if len(req.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    db = get_db()
    try:
        row = db.execute(
            "SELECT password_hash FROM users WHERE username = ?", (username,)
        ).fetchone()
        if not row or not verify_password(req.current_password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="Current password is incorrect")

        db.execute(
            "UPDATE users SET password_hash = ? WHERE username = ?",
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
    if len(req.username) < 2:
        raise HTTPException(status_code=400, detail="Username must be at least 2 characters")
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

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

    logger.info(f"Admin '{admin}' created app user '{req.username}'")
    return {"message": "User created", "username": req.username}


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
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    db = get_db()
    try:
        row = db.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")

        db.execute(
            "UPDATE users SET password_hash = ? WHERE username = ?",
            (hash_password(req.password), username),
        )
        db.commit()
    finally:
        db.close()

    logger.info(f"Admin '{admin}' reset password for app user '{username}'")
    return {"message": "Password reset successfully"}
