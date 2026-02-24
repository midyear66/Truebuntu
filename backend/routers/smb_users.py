import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.utils.auth import get_current_admin
from backend.utils.shell import run

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/smb-users", tags=["smb-users"], dependencies=[Depends(get_current_admin)])

VALID_USERNAME = re.compile(r"^[a-z_][a-z0-9_-]*$")
SYSTEM_UID_MAX = 999


class SmbPasswordRequest(BaseModel):
    password: str


class SmbAddRequest(BaseModel):
    username: str
    password: str


def _list_smb_users() -> list[dict]:
    result = run(["net", "sam", "list", "users"])
    if not result.ok:
        logger.warning(f"net sam list users failed (rc={result.returncode}): {result.stderr.strip()}")
        return []
    users = []
    for line in result.stdout.strip().splitlines():
        username = line.strip()
        if not username or username.endswith("$"):
            continue
        uid = None
        id_result = run(["getent", "passwd", username])
        if id_result.ok:
            parts = id_result.stdout.strip().split(":")
            if len(parts) >= 3 and parts[2].isdigit():
                uid = int(parts[2])
        users.append({"username": username, "uid": uid})
    return users


def _list_system_users() -> list[dict]:
    result = run(["getent", "passwd"])
    if not result.ok:
        return []
    users = []
    for line in result.stdout.strip().splitlines():
        parts = line.split(":")
        if len(parts) >= 7:
            uid = int(parts[2])
            if uid >= 1000:
                users.append({"username": parts[0], "uid": uid})
    return users


@router.get("")
def list_smb_users():
    smb_users = _list_smb_users()
    system_users = _list_system_users()
    smb_names = {u["username"] for u in smb_users}
    available = [u for u in system_users if u["username"] not in smb_names]
    return {"smb_users": smb_users, "system_users": available}


@router.post("")
def add_smb_user(req: SmbAddRequest):
    if not VALID_USERNAME.match(req.username):
        raise HTTPException(status_code=400, detail="Invalid username")
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    # Verify user exists as system user
    system_users = {u["username"] for u in _list_system_users()}
    if req.username not in system_users:
        raise HTTPException(status_code=400, detail="User does not exist as a system user")

    result = run(["smbpasswd", "-a", "-s", req.username], stdin=f"{req.password}\n{req.password}\n")
    if not result.ok:
        raise HTTPException(status_code=500, detail=result.stderr.strip() or "Failed to add Samba user")

    logger.info(f"Added Samba user '{req.username}'")
    return {"message": f"Samba user '{req.username}' added"}


@router.delete("/{username}")
def remove_smb_user(username: str):
    if not VALID_USERNAME.match(username):
        raise HTTPException(status_code=400, detail="Invalid username")

    result = run(["smbpasswd", "-x", username])
    if not result.ok:
        raise HTTPException(status_code=500, detail=result.stderr.strip() or "Failed to remove Samba user")

    logger.info(f"Removed Samba user '{username}'")
    return {"message": f"Samba user '{username}' removed"}


@router.post("/{username}/password")
def change_smb_password(username: str, req: SmbPasswordRequest):
    if not VALID_USERNAME.match(username):
        raise HTTPException(status_code=400, detail="Invalid username")
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    result = run(["smbpasswd", "-a", "-s", username], stdin=f"{req.password}\n{req.password}\n")
    if not result.ok:
        raise HTTPException(status_code=500, detail=result.stderr.strip() or "Failed to change Samba password")

    logger.info(f"Changed Samba password for '{username}'")
    return {"message": f"Samba password changed for '{username}'"}
