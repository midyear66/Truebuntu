import logging
import os
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.utils.auth import get_current_user, get_current_admin
from backend.utils.shell import run
from backend.utils.exports import parse_exports, add_export, update_export, remove_export
from backend.utils.zfs import get_pool_mountpoints

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/nfs", tags=["nfs"], dependencies=[Depends(get_current_user)])

DANGEROUS_CHARS = re.compile(r"[\n\r`$;|&\\]")
VALID_EXPORT_PREFIXES = ("/mnt/", "/data/", "/pool/", "/tank/")


def _validate_nfs_clients(clients: list["NFSClient"]):
    for c in clients:
        if DANGEROUS_CHARS.search(c.host):
            raise HTTPException(status_code=400, detail="Invalid characters in NFS host")
        if DANGEROUS_CHARS.search(c.options):
            raise HTTPException(status_code=400, detail="Invalid characters in NFS options")


def _is_valid_export_path(path: str) -> bool:
    canonical = os.path.realpath(path)
    if any(canonical.startswith(p) for p in VALID_EXPORT_PREFIXES):
        return True
    pool_mounts = get_pool_mountpoints()
    return any(canonical.startswith(m) for m in pool_mounts)


class NFSClient(BaseModel):
    host: str
    options: str = "rw,sync,no_subtree_check"


class NFSExportCreate(BaseModel):
    path: str
    clients: list[NFSClient]


class NFSExportUpdate(BaseModel):
    clients: list[NFSClient]


@router.get("")
def list_exports():
    return parse_exports()


@router.post("")
def create_export(req: NFSExportCreate, username: str = Depends(get_current_admin)):
    _validate_nfs_clients(req.clients)
    if not _is_valid_export_path(req.path):
        raise HTTPException(status_code=400, detail="Path must be under a known ZFS mountpoint or /mnt/, /data/, /pool/, /tank/")
    try:
        add_export(req.path, [c.model_dump() for c in req.clients])
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

    _reload_exports()
    logger.info(f"User '{username}' created NFS export '{req.path}'")
    return {"message": f"NFS export '{req.path}' created"}


@router.put("/{path:path}")
def modify_export(path: str, req: NFSExportUpdate, username: str = Depends(get_current_admin)):
    _validate_nfs_clients(req.clients)
    export_path = f"/{path}"
    try:
        update_export(export_path, [c.model_dump() for c in req.clients])
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    _reload_exports()
    logger.info(f"User '{username}' updated NFS export '{export_path}'")
    return {"message": f"NFS export '{export_path}' updated"}


@router.delete("/{path:path}")
def delete_export(path: str, username: str = Depends(get_current_admin)):
    export_path = f"/{path}"
    try:
        remove_export(export_path)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    _reload_exports()
    logger.info(f"User '{username}' deleted NFS export '{export_path}'")
    return {"message": f"NFS export '{export_path}' deleted"}


@router.post("/reload")
def reload_exports(username: str = Depends(get_current_admin)):
    _reload_exports()
    logger.info(f"User '{username}' reloaded NFS exports")
    return {"message": "NFS exports reloaded"}


def _reload_exports():
    result = run(["exportfs", "-ra"])
    if not result.ok:
        logger.warning(f"exportfs -ra failed: {result.stderr}")
