import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.utils.auth import get_current_user
from backend.utils.shell import run
from backend.utils.zfs import parse_zpool_list, parse_zpool_status, list_available_disks

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/pools", tags=["pools"], dependencies=[Depends(get_current_user)])

VALID_NAME = re.compile(r"^[a-zA-Z][a-zA-Z0-9_.-]*$")
VALID_TOPOLOGIES = {"mirror", "raidz", "raidz2", "raidz3", "stripe"}


class PoolCreateRequest(BaseModel):
    name: str
    topology: str
    disks: list[str]
    force: bool = False


class PoolDestroyRequest(BaseModel):
    confirm: str


@router.get("")
def list_pools():
    return parse_zpool_list()


@router.get("/{pool}")
def pool_detail(pool: str):
    if not VALID_NAME.match(pool):
        raise HTTPException(status_code=400, detail="Invalid pool name")
    status = parse_zpool_status(pool)
    if "error" in status:
        raise HTTPException(status_code=404, detail=status["error"])
    return status


@router.post("")
def create_pool(req: PoolCreateRequest, username: str = Depends(get_current_user)):
    if not VALID_NAME.match(req.name):
        raise HTTPException(status_code=400, detail="Invalid pool name")
    if req.topology not in VALID_TOPOLOGIES:
        raise HTTPException(status_code=400, detail=f"Invalid topology: {req.topology}")
    if len(req.disks) < 1:
        raise HTTPException(status_code=400, detail="At least one disk required")

    for disk in req.disks:
        if not re.match(r"^/dev/[a-zA-Z0-9]+$", disk):
            raise HTTPException(status_code=400, detail=f"Invalid disk path: {disk}")

    cmd = ["zpool", "create"]
    if req.force:
        cmd.append("-f")
    cmd.append(req.name)
    if req.topology != "stripe":
        cmd.append(req.topology)
    cmd.extend(req.disks)

    result = run(cmd, timeout=60)
    if not result.ok:
        raise HTTPException(status_code=500, detail=result.stderr.strip())

    logger.info(f"User '{username}' created pool '{req.name}' ({req.topology}) with disks {req.disks}")
    return {"message": f"Pool '{req.name}' created", "pool": req.name}


@router.delete("/{pool}")
def destroy_pool(pool: str, req: PoolDestroyRequest, username: str = Depends(get_current_user)):
    if not VALID_NAME.match(pool):
        raise HTTPException(status_code=400, detail="Invalid pool name")
    if req.confirm != pool:
        raise HTTPException(status_code=400, detail="Confirmation name does not match pool name")

    result = run(["zpool", "destroy", pool], timeout=60)
    if not result.ok:
        raise HTTPException(status_code=500, detail=result.stderr.strip())

    logger.info(f"User '{username}' destroyed pool '{pool}'")
    return {"message": f"Pool '{pool}' destroyed"}


@router.post("/{pool}/scrub")
def start_scrub(pool: str, username: str = Depends(get_current_user)):
    if not VALID_NAME.match(pool):
        raise HTTPException(status_code=400, detail="Invalid pool name")

    result = run(["zpool", "scrub", pool])
    if not result.ok:
        raise HTTPException(status_code=500, detail=result.stderr.strip())

    logger.info(f"User '{username}' started scrub on pool '{pool}'")
    return {"message": f"Scrub started on '{pool}'"}


@router.post("/{pool}/scrub/stop")
def stop_scrub(pool: str, username: str = Depends(get_current_user)):
    if not VALID_NAME.match(pool):
        raise HTTPException(status_code=400, detail="Invalid pool name")

    result = run(["zpool", "scrub", "-s", pool])
    if not result.ok:
        raise HTTPException(status_code=500, detail=result.stderr.strip())

    logger.info(f"User '{username}' stopped scrub on pool '{pool}'")
    return {"message": f"Scrub stopped on '{pool}'"}


@router.get("/{pool}/history")
def pool_history(pool: str, count: int = 50):
    if not VALID_NAME.match(pool):
        raise HTTPException(status_code=400, detail="Invalid pool name")

    result = run(["zpool", "history", pool])
    if not result.ok:
        raise HTTPException(status_code=500, detail=result.stderr.strip())

    lines = result.stdout.strip().splitlines()
    return {"pool": pool, "history": lines[-count:]}


disks_router = APIRouter(prefix="/disks", tags=["disks"], dependencies=[Depends(get_current_user)])


@disks_router.get("/available")
def available_disks():
    return list_available_disks()
