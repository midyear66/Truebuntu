import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.utils.auth import get_current_user
from backend.utils.shell import run

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/rclone", tags=["rclone"], dependencies=[Depends(get_current_user)])

RCLONE_CONFIG = "/data/rclone.conf"


class RemoteCreateRequest(BaseModel):
    name: str
    type: str
    config: dict[str, str]


@router.get("/remotes")
def list_remotes():
    result = run(["rclone", "listremotes", "--config", RCLONE_CONFIG])
    if not result.ok:
        return []
    remotes = [r.rstrip(":") for r in result.stdout.strip().splitlines() if r.strip()]
    return remotes


@router.get("/remotes/{name}")
def remote_detail(name: str):
    result = run(["rclone", "config", "show", name, "--config", RCLONE_CONFIG])
    if not result.ok:
        raise HTTPException(status_code=404, detail=f"Remote '{name}' not found")
    config = {}
    for line in result.stdout.strip().splitlines():
        if "=" in line and not line.startswith("["):
            key, _, value = line.partition("=")
            config[key.strip()] = value.strip()
    return {"name": name, "config": config}


@router.post("/remotes")
def create_remote(req: RemoteCreateRequest, username: str = Depends(get_current_user)):
    cmd = [
        "rclone", "config", "create", req.name, req.type,
        "--config", RCLONE_CONFIG,
    ]
    for key, value in req.config.items():
        cmd.extend([key, value])

    result = run(cmd)
    if not result.ok:
        raise HTTPException(status_code=500, detail=result.stderr.strip())

    logger.info(f"User '{username}' created rclone remote '{req.name}' (type={req.type})")
    return {"message": f"Remote '{req.name}' created"}


@router.delete("/remotes/{name}")
def delete_remote(name: str, username: str = Depends(get_current_user)):
    result = run(["rclone", "config", "delete", name, "--config", RCLONE_CONFIG])
    if not result.ok:
        raise HTTPException(status_code=500, detail=result.stderr.strip())

    logger.info(f"User '{username}' deleted rclone remote '{name}'")
    return {"message": f"Remote '{name}' deleted"}


@router.post("/remotes/{name}/test")
def test_remote(name: str):
    result = run(["rclone", "about", f"{name}:", "--config", RCLONE_CONFIG, "--json"], timeout=30)
    if not result.ok:
        return {"success": False, "error": result.stderr.strip()}

    try:
        info = json.loads(result.stdout)
        return {"success": True, "info": info}
    except json.JSONDecodeError:
        return {"success": True, "raw": result.stdout}
