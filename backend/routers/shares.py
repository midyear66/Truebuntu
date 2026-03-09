import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.utils.auth import get_current_user, get_current_admin
from backend.utils.shell import run
from backend.utils.smb_conf import get_shares, add_share, update_share, remove_share

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/shares", tags=["shares"], dependencies=[Depends(get_current_user)])

ALLOWED_PATH_PREFIXES = ("/mnt/", "/data/", "/pool/", "/tank/")
VALID_OWNER = re.compile(r"^[a-zA-Z0-9_.-]+$")


class ShareCreateRequest(BaseModel):
    name: str
    path: str
    comment: str = ""
    browseable: str = "yes"
    read_only: str = "no"
    guest_ok: str = "no"
    valid_users: str = ""
    write_list: str = ""
    create_mask: str = "0664"
    directory_mask: str = "0775"
    extra: dict[str, str] = {}


class ShareUpdateRequest(BaseModel):
    path: str | None = None
    comment: str | None = None
    browseable: str | None = None
    read_only: str | None = None
    guest_ok: str | None = None
    valid_users: str | None = None
    write_list: str | None = None
    create_mask: str | None = None
    directory_mask: str | None = None
    extra: dict[str, str] = {}


def _build_params(req) -> dict[str, str]:
    params = {}
    field_map = {
        "path": "path",
        "comment": "comment",
        "browseable": "browseable",
        "read_only": "read only",
        "guest_ok": "guest ok",
        "valid_users": "valid users",
        "write_list": "write list",
        "create_mask": "create mask",
        "directory_mask": "directory mask",
    }
    for attr, conf_key in field_map.items():
        val = getattr(req, attr, None)
        if val is not None and val != "":
            params[conf_key] = val
    if hasattr(req, "extra"):
        params.update(req.extra)
    return params


@router.get("")
def list_shares():
    return get_shares()


@router.post("")
def create_share(req: ShareCreateRequest, username: str = Depends(get_current_admin)):
    if req.path and not req.path.startswith(ALLOWED_PATH_PREFIXES):
        raise HTTPException(status_code=400, detail="Path must start with /mnt/, /data/, /pool/, or /tank/")

    existing = [s["name"] for s in get_shares()]
    if req.name in existing:
        raise HTTPException(status_code=409, detail=f"Share '{req.name}' already exists")

    params = _build_params(req)
    add_share(req.name, params)
    _reload_smbd()

    # Set directory ownership so write_list users can actually write
    owner = (req.write_list or req.valid_users or "").split(",")[0].strip().lstrip("@")
    if owner and req.path:
        if not VALID_OWNER.match(owner):
            raise HTTPException(status_code=400, detail=f"Invalid owner name: {owner}")
        run(["chown", "-R", f"{owner}:{owner}", req.path])

    logger.info(f"User '{username}' created SMB share '{req.name}'")
    return {"message": f"Share '{req.name}' created"}


@router.put("/{name}")
def modify_share(name: str, req: ShareUpdateRequest, username: str = Depends(get_current_admin)):
    existing = {s["name"]: s for s in get_shares()}
    if name not in existing:
        raise HTTPException(status_code=404, detail=f"Share '{name}' not found")

    current = existing[name]
    current.pop("name", None)
    params = current.copy()
    updates = _build_params(req)
    params.update(updates)
    update_share(name, params)
    _reload_smbd()

    logger.info(f"User '{username}' updated SMB share '{name}'")
    return {"message": f"Share '{name}' updated"}


@router.delete("/{name}")
def delete_share(name: str, username: str = Depends(get_current_admin)):
    existing = [s["name"] for s in get_shares()]
    if name not in existing:
        raise HTTPException(status_code=404, detail=f"Share '{name}' not found")

    remove_share(name)
    _reload_smbd()

    logger.info(f"User '{username}' deleted SMB share '{name}'")
    return {"message": f"Share '{name}' deleted"}


@router.get("/sessions")
def active_sessions():
    result = run(["smbstatus", "--json"])
    if result.ok:
        import json
        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError:
            pass
    result = run(["smbstatus", "-b"])
    return {"raw": result.stdout if result.ok else result.stderr}


def _reload_smbd():
    result = run(["systemctl", "reload", "smbd"])
    if not result.ok:
        run(["systemctl", "restart", "smbd"])
