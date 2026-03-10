import json
import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.utils.auth import get_current_admin
from backend.utils.shell import run

VALID_RCLONE_NAME = re.compile(r"^[a-zA-Z0-9_-]+$")

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/rclone", tags=["rclone"], dependencies=[Depends(get_current_admin)])

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
def create_remote(req: RemoteCreateRequest, username: str = Depends(get_current_admin)):
    if not VALID_RCLONE_NAME.match(req.name):
        raise HTTPException(status_code=400, detail="Invalid remote name")
    if not VALID_RCLONE_NAME.match(req.type):
        raise HTTPException(status_code=400, detail="Invalid remote type")
    for key in req.config:
        if not VALID_RCLONE_NAME.match(key):
            raise HTTPException(status_code=400, detail=f"Invalid config key: {key}")

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
def delete_remote(name: str, username: str = Depends(get_current_admin)):
    result = run(["rclone", "config", "delete", name, "--config", RCLONE_CONFIG])
    if not result.ok:
        raise HTTPException(status_code=500, detail=result.stderr.strip())

    logger.info(f"User '{username}' deleted rclone remote '{name}'")
    return {"message": f"Remote '{name}' deleted"}


@router.post("/remotes/{name}/test")
def test_remote(name: str):
    # Use lsd (list directories) as a universal connectivity test —
    # "about" is not supported by all providers (e.g. Backblaze B2)
    result = run(["rclone", "lsd", f"{name}:", "--config", RCLONE_CONFIG, "--max-depth", "1"], timeout=30)
    if not result.ok:
        return {"success": False, "error": result.stderr.strip()}
    return {"success": True}


@router.get("/remotes/{name}/buckets")
def list_buckets(name: str):
    """List top-level buckets/directories for a remote."""
    result = run(["rclone", "lsd", f"{name}:", "--config", RCLONE_CONFIG, "--max-depth", "1"], timeout=30)
    if not result.ok:
        return {"buckets": [], "error": result.stderr.strip()}
    buckets = []
    for line in result.stdout.strip().splitlines():
        # rclone lsd output: "          -1 2024-01-15 10:30:00        -1 bucket-name"
        parts = line.split()
        if parts:
            buckets.append(parts[-1])
    return {"buckets": sorted(buckets)}
