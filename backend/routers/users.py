import logging
import re
import subprocess

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from backend.utils.auth import get_current_admin
from backend.utils.rate_limit import limiter
from backend.utils.system_users import (
    host_group_gid,
    create_host_group,
    create_host_user,
    delete_host_user,
    add_host_user_to_group,
    set_host_password,
    set_samba_password,
    delete_samba_password,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/users", tags=["users"], dependencies=[Depends(get_current_admin)])

VALID_USERNAME = re.compile(r"^[a-z_][a-z0-9_-]*$")
SYSTEM_UID_MAX = 999


class UserCreateRequest(BaseModel):
    username: str
    password: str
    uid: int | None = None
    gid: int | None = None
    primary_group: str | None = None  # existing group name
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

    # Resolve primary group: use existing group name, or create group with specified GID
    primary_gid = None
    if req.primary_group:
        # Use an existing group by name
        primary_gid = host_group_gid(req.primary_group)
        if primary_gid is None:
            raise HTTPException(status_code=400, detail=f"Group '{req.primary_group}' does not exist")
    elif req.gid is not None:
        if host_group_gid(str(req.gid)) is None:
            # Create the group with the requested GID (use the username as group name)
            ok, err = create_host_group(req.username, gid=req.gid)
            if not ok:
                raise HTTPException(status_code=500, detail=f"Failed to create group: {err}")
        primary_gid = str(req.gid)

    ok, err = create_host_user(
        req.username,
        create_home=req.create_home,
        uid=req.uid,
        gid=primary_gid,
        groups=req.groups,
    )
    if not ok:
        raise HTTPException(status_code=500, detail=err)

    ok, err = set_host_password(req.username, req.password)
    if not ok:
        logger.warning(f"Failed to set password for {req.username}: {err}")

    if req.smb_user:
        ok, err = set_samba_password(req.username, req.password)
        if not ok:
            logger.warning(f"Failed to add Samba user {req.username}: {err}")

    logger.info(f"User '{username}' created system user '{req.username}' (uid={req.uid})")
    return {"message": f"User '{req.username}' created"}


@router.delete("/{target_user}")
def delete_user(target_user: str, username: str = Depends(get_current_admin)):
    if not VALID_USERNAME.match(target_user):
        raise HTTPException(status_code=400, detail="Invalid username")

    delete_samba_password(target_user)
    ok, err = delete_host_user(target_user)
    if not ok:
        raise HTTPException(status_code=500, detail=err)

    logger.info(f"User '{username}' deleted system user '{target_user}'")
    return {"message": f"User '{target_user}' deleted"}


@router.post("/{target_user}/password")
@limiter.limit("5/minute")
def change_password(request: Request, target_user: str, req: UserPasswordRequest, username: str = Depends(get_current_admin)):
    if not VALID_USERNAME.match(target_user):
        raise HTTPException(status_code=400, detail="Invalid username")
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    ok, err = set_host_password(target_user, req.password)
    if not ok:
        logger.warning(f"chpasswd failed for {target_user}: {err}")
        raise HTTPException(status_code=500, detail="Failed to change password")

    ok, err = set_samba_password(target_user, req.password)
    if not ok:
        logger.warning(f"Failed to update Samba password for {target_user}: {err}")

    logger.info(f"User '{username}' changed password for '{target_user}'")
    return {"message": f"Password changed for '{target_user}'"}


@router.post("/groups")
def create_group(req: GroupCreateRequest, username: str = Depends(get_current_admin)):
    if not VALID_USERNAME.match(req.name):
        raise HTTPException(status_code=400, detail="Invalid group name")

    ok, err = create_host_group(req.name, gid=req.gid)
    if not ok:
        raise HTTPException(status_code=500, detail=err)

    logger.info(f"User '{username}' created group '{req.name}'")
    return {"message": f"Group '{req.name}' created"}


@router.post("/{target_user}/groups/{group}")
def add_user_to_group(target_user: str, group: str, username: str = Depends(get_current_admin)):
    if not VALID_USERNAME.match(target_user):
        raise HTTPException(status_code=400, detail="Invalid username")
    if not VALID_USERNAME.match(group):
        raise HTTPException(status_code=400, detail="Invalid group name")
    ok, err = add_host_user_to_group(target_user, group)
    if not ok:
        raise HTTPException(status_code=500, detail=err)

    logger.info(f"User '{username}' added '{target_user}' to group '{group}'")
    return {"message": f"User '{target_user}' added to group '{group}'"}
