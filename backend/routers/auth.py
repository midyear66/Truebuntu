import logging

from fastapi import APIRouter, HTTPException, Response, Depends
from pydantic import BaseModel

from backend.database import get_db, admin_exists
from backend.utils.auth import (
    hash_password,
    verify_password,
    create_token,
    get_current_user,
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
            "SELECT username, password_hash FROM users WHERE username = ?",
            (req.username,),
        ).fetchone()
    finally:
        db.close()

    if not row or not verify_password(req.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_token(req.username)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="strict",
        path="/",
    )
    logger.info(f"User '{req.username}' logged in")
    return {"message": "Logged in", "username": req.username}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(key=COOKIE_NAME, path="/")
    return {"message": "Logged out"}


@router.get("/me")
def me(username: str = Depends(get_current_user)):
    return {"username": username}
