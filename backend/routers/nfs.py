import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.utils.auth import get_current_user
from backend.utils.shell import run
from backend.utils.exports import parse_exports, add_export, update_export, remove_export

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/nfs", tags=["nfs"], dependencies=[Depends(get_current_user)])


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
def create_export(req: NFSExportCreate, username: str = Depends(get_current_user)):
    try:
        add_export(req.path, [c.model_dump() for c in req.clients])
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

    _reload_exports()
    logger.info(f"User '{username}' created NFS export '{req.path}'")
    return {"message": f"NFS export '{req.path}' created"}


@router.put("/{path:path}")
def modify_export(path: str, req: NFSExportUpdate, username: str = Depends(get_current_user)):
    export_path = f"/{path}"
    try:
        update_export(export_path, [c.model_dump() for c in req.clients])
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    _reload_exports()
    logger.info(f"User '{username}' updated NFS export '{export_path}'")
    return {"message": f"NFS export '{export_path}' updated"}


@router.delete("/{path:path}")
def delete_export(path: str, username: str = Depends(get_current_user)):
    export_path = f"/{path}"
    try:
        remove_export(export_path)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    _reload_exports()
    logger.info(f"User '{username}' deleted NFS export '{export_path}'")
    return {"message": f"NFS export '{export_path}' deleted"}


@router.post("/reload")
def reload_exports(username: str = Depends(get_current_user)):
    _reload_exports()
    logger.info(f"User '{username}' reloaded NFS exports")
    return {"message": "NFS exports reloaded"}


def _reload_exports():
    result = run(["exportfs", "-ra"])
    if not result.ok:
        logger.warning(f"exportfs -ra failed: {result.stderr}")
