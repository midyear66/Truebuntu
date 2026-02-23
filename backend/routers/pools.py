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
RESERVED_NAMES = {"mirror", "raidz", "raidz1", "raidz2", "raidz3", "spare", "log", "cache", "replace", "fault", "online", "offline"}
MIN_DISKS = {"mirror": 2, "raidz": 3, "raidz2": 4, "raidz3": 5, "stripe": 1}
VALID_DISK_PATH = re.compile(r"^/dev/[a-zA-Z0-9]+$")


class PoolCreateRequest(BaseModel):
    name: str
    topology: str
    disks: list[str]
    spares: list[str] = []
    log: list[str] = []
    cache: list[str] = []
    force: bool = False


class PoolDestroyRequest(BaseModel):
    confirm: str


class DiskReplaceRequest(BaseModel):
    old_disk: str
    new_disk: str
    force: bool = False


VALID_DISK = re.compile(r"^[a-zA-Z0-9_-]+$")


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
    if req.name.lower() in RESERVED_NAMES:
        raise HTTPException(status_code=400, detail=f"Reserved pool name: {req.name}")
    if req.topology not in VALID_TOPOLOGIES:
        raise HTTPException(status_code=400, detail=f"Invalid topology: {req.topology}")

    min_disks = MIN_DISKS.get(req.topology, 1)
    if len(req.disks) < min_disks:
        raise HTTPException(status_code=400, detail=f"{req.topology} requires at least {min_disks} disks")

    # Check for duplicate disks across all roles
    all_disks = req.disks + req.spares + req.log + req.cache
    if len(all_disks) != len(set(all_disks)):
        raise HTTPException(status_code=400, detail="Duplicate disk detected across roles")

    for disk in all_disks:
        if not VALID_DISK_PATH.match(disk):
            raise HTTPException(status_code=400, detail=f"Invalid disk path: {disk}")

    cmd = ["zpool", "create"]
    if req.force:
        cmd.append("-f")
    cmd.append(req.name)
    if req.topology != "stripe":
        cmd.append(req.topology)
    cmd.extend(req.disks)
    if req.spares:
        cmd.append("spare")
        cmd.extend(req.spares)
    if req.log:
        cmd.append("log")
        cmd.extend(req.log)
    if req.cache:
        cmd.append("cache")
        cmd.extend(req.cache)

    result = run(cmd, timeout=60)
    if not result.ok:
        raise HTTPException(status_code=500, detail=result.stderr.strip())

    logger.info(f"User '{username}' created pool '{req.name}' ({req.topology}) with disks {req.disks}, spares {req.spares}")
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


@router.post("/{pool}/replace")
def replace_disk(pool: str, req: DiskReplaceRequest, username: str = Depends(get_current_user)):
    if not VALID_NAME.match(pool):
        raise HTTPException(status_code=400, detail="Invalid pool name")
    if not VALID_DISK.match(req.old_disk) or not VALID_DISK.match(req.new_disk):
        raise HTTPException(status_code=400, detail="Invalid disk name")

    cmd = ["zpool", "replace"]
    if req.force:
        cmd.append("-f")
    cmd.extend([pool, req.old_disk, req.new_disk])

    result = run(cmd, timeout=60)
    if not result.ok:
        raise HTTPException(status_code=500, detail=result.stderr.strip())

    logger.info(f"User '{username}' replaced disk {req.old_disk} with {req.new_disk} in pool '{pool}'")
    return {"message": f"Disk replacement started: {req.old_disk} -> {req.new_disk}"}


@router.post("/{pool}/disk/{disk}/offline")
def offline_disk(pool: str, disk: str, username: str = Depends(get_current_user)):
    if not VALID_NAME.match(pool):
        raise HTTPException(status_code=400, detail="Invalid pool name")
    if not VALID_DISK.match(disk):
        raise HTTPException(status_code=400, detail="Invalid disk name")

    result = run(["zpool", "offline", pool, disk], timeout=30)
    if not result.ok:
        raise HTTPException(status_code=500, detail=result.stderr.strip())

    logger.info(f"User '{username}' offlined disk {disk} in pool '{pool}'")
    return {"message": f"Disk {disk} taken offline"}


@router.post("/{pool}/disk/{disk}/online")
def online_disk(pool: str, disk: str, username: str = Depends(get_current_user)):
    if not VALID_NAME.match(pool):
        raise HTTPException(status_code=400, detail="Invalid pool name")
    if not VALID_DISK.match(disk):
        raise HTTPException(status_code=400, detail="Invalid disk name")

    result = run(["zpool", "online", pool, disk], timeout=30)
    if not result.ok:
        raise HTTPException(status_code=500, detail=result.stderr.strip())

    logger.info(f"User '{username}' onlined disk {disk} in pool '{pool}'")
    return {"message": f"Disk {disk} brought online"}


@router.post("/{pool}/disk/{disk}/detach")
def detach_disk(pool: str, disk: str, username: str = Depends(get_current_user)):
    if not VALID_NAME.match(pool):
        raise HTTPException(status_code=400, detail="Invalid pool name")
    if not VALID_DISK.match(disk):
        raise HTTPException(status_code=400, detail="Invalid disk name")

    result = run(["zpool", "detach", pool, disk], timeout=30)
    if not result.ok:
        raise HTTPException(status_code=500, detail=result.stderr.strip())

    logger.info(f"User '{username}' detached disk {disk} from pool '{pool}'")
    return {"message": f"Disk {disk} detached from pool"}


disks_router = APIRouter(prefix="/disks", tags=["disks"], dependencies=[Depends(get_current_user)])


@disks_router.get("/available")
def available_disks():
    return list_available_disks()
