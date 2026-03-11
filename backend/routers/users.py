import logging
import re
import subprocess

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.utils.auth import get_current_admin
from backend.utils.shell import run

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/users", tags=["users"], dependencies=[Depends(get_current_admin)])

VALID_USERNAME = re.compile(r"^[a-z_][a-z0-9_-]*$")
SYSTEM_UID_MAX = 999


class UserCreateRequest(BaseModel):
    username: str
    password: str
    uid: int | None = None
    groups: list[str] = []
    create_home: bool = True
    smb_user: bool = True


class UserPasswordRequest(BaseModel):
    password: str


class GroupCreateRequest(BaseModel):
    name: str
    gid: int | None = None


@router.get("")
def list_users():
    proc = subprocess.run(
        ["nsenter", "-t", "1", "-m", "-u", "-n", "-i", "getent", "passwd"],
        capture_output=True, text=True, timeout=10,
    )
    if proc.returncode != 0:
        return []
    users = []
    for line in proc.stdout.strip().splitlines():
        parts = line.split(":")
        if len(parts) >= 7:
            uid = int(parts[2])
            if uid >= 500:
                users.append({
                    "username": parts[0],
                    "uid": uid,
                    "gid": int(parts[3]),
                    "comment": parts[4],
                    "home": parts[5],
                    "shell": parts[6],
                })
    return users


@router.get("/groups")
def list_groups():
    proc = subprocess.run(
        ["nsenter", "-t", "1", "-m", "-u", "-n", "-i", "getent", "group"],
        capture_output=True, text=True, timeout=10,
    )
    if proc.returncode != 0:
        return []
    groups = []
    for line in proc.stdout.strip().splitlines():
        parts = line.split(":")
        if len(parts) >= 4:
            gid = int(parts[2])
            if gid >= 100:
                groups.append({
                    "name": parts[0],
                    "gid": gid,
                    "members": parts[3].split(",") if parts[3] else [],
                })
    return groups


@router.post("")
def create_user(req: UserCreateRequest, username: str = Depends(get_current_admin)):
    if not VALID_USERNAME.match(req.username):
        raise HTTPException(status_code=400, detail="Invalid username")
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    cmd = ["nsenter", "-t", "1", "-m", "-u", "-n", "-i", "useradd"]
    if req.uid is not None:
        cmd.extend(["-u", str(req.uid)])
    if req.create_home:
        cmd.append("-m")
    else:
        cmd.extend(["-M"])
    if req.groups:
        cmd.extend(["-G", ",".join(req.groups)])
    cmd.append(req.username)

    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    if proc.returncode != 0:
        raise HTTPException(status_code=500, detail=proc.stderr.strip())

    # Set password via chpasswd on host
    proc = subprocess.run(
        ["nsenter", "-t", "1", "-m", "-u", "-n", "-i", "chpasswd"],
        input=f"{req.username}:{req.password}\n",
        capture_output=True, text=True, timeout=10,
    )
    if proc.returncode != 0:
        logger.warning(f"Failed to set password for {req.username}: {proc.stderr}")

    if req.smb_user:
        proc = subprocess.run(
            ["smbpasswd", "-a", "-s", req.username],
            input=f"{req.password}\n{req.password}\n",
            capture_output=True, text=True, timeout=10,
        )
        if proc.returncode != 0:
            logger.warning(f"Failed to add Samba user {req.username}: {proc.stderr}")

    logger.info(f"User '{username}' created system user '{req.username}' (uid={req.uid})")
    return {"message": f"User '{req.username}' created"}


@router.delete("/{target_user}")
def delete_user(target_user: str, username: str = Depends(get_current_admin)):
    if not VALID_USERNAME.match(target_user):
        raise HTTPException(status_code=400, detail="Invalid username")

    run(["smbpasswd", "-x", target_user])
    proc = subprocess.run(
        ["nsenter", "-t", "1", "-m", "-u", "-n", "-i", "userdel", target_user],
        capture_output=True, text=True, timeout=10,
    )
    if proc.returncode != 0:
        raise HTTPException(status_code=500, detail=proc.stderr.strip())

    logger.info(f"User '{username}' deleted system user '{target_user}'")
    return {"message": f"User '{target_user}' deleted"}


@router.post("/{target_user}/password")
def change_password(target_user: str, req: UserPasswordRequest, username: str = Depends(get_current_admin)):
    if not VALID_USERNAME.match(target_user):
        raise HTTPException(status_code=400, detail="Invalid username")
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    proc = subprocess.run(
        ["nsenter", "-t", "1", "-m", "-u", "-n", "-i", "chpasswd"],
        input=f"{target_user}:{req.password}\n",
        capture_output=True, text=True, timeout=10,
    )
    if proc.returncode != 0:
        raise HTTPException(status_code=500, detail="Failed to change password")

    proc = subprocess.run(
        ["smbpasswd", "-a", "-s", target_user],
        input=f"{req.password}\n{req.password}\n",
        capture_output=True, text=True, timeout=10,
    )

    logger.info(f"User '{username}' changed password for '{target_user}'")
    return {"message": f"Password changed for '{target_user}'"}


@router.post("/groups")
def create_group(req: GroupCreateRequest, username: str = Depends(get_current_admin)):
    if not VALID_USERNAME.match(req.name):
        raise HTTPException(status_code=400, detail="Invalid group name")

    cmd = ["nsenter", "-t", "1", "-m", "-u", "-n", "-i", "groupadd"]
    if req.gid is not None:
        cmd.extend(["-g", str(req.gid)])
    cmd.append(req.name)

    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    if proc.returncode != 0:
        raise HTTPException(status_code=500, detail=proc.stderr.strip())

    logger.info(f"User '{username}' created group '{req.name}'")
    return {"message": f"Group '{req.name}' created"}


@router.post("/{target_user}/groups/{group}")
def add_user_to_group(target_user: str, group: str, username: str = Depends(get_current_admin)):
    if not VALID_USERNAME.match(target_user):
        raise HTTPException(status_code=400, detail="Invalid username")
    if not VALID_USERNAME.match(group):
        raise HTTPException(status_code=400, detail="Invalid group name")
    proc = subprocess.run(
        ["nsenter", "-t", "1", "-m", "-u", "-n", "-i", "usermod", "-aG", group, target_user],
        capture_output=True, text=True, timeout=10,
    )
    if proc.returncode != 0:
        raise HTTPException(status_code=500, detail=proc.stderr.strip())

    logger.info(f"User '{username}' added '{target_user}' to group '{group}'")
    return {"message": f"User '{target_user}' added to group '{group}'"}
