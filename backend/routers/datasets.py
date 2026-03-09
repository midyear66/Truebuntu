import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.utils.auth import get_current_user, get_current_admin
from backend.utils.shell import run
from backend.utils.zfs import parse_zfs_list, parse_zfs_get

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/datasets", tags=["datasets"], dependencies=[Depends(get_current_user)])

VALID_DATASET = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_./-]*$")


class DatasetCreateRequest(BaseModel):
    name: str
    properties: dict[str, str] = {}


class DatasetUpdateRequest(BaseModel):
    properties: dict[str, str]


EDITABLE_PROPERTIES = {
    "quota", "refquota", "reservation", "refreservation",
    "compression", "atime", "relatime", "dedup",
    "recordsize", "mountpoint", "readonly", "exec",
    "setuid", "acltype", "aclmode", "xattr",
    "snapdir", "sync", "logbias", "copies",
}


@router.get("")
def list_datasets(pool: str | None = None):
    return parse_zfs_list(pool)


@router.get("/{dataset:path}/properties")
def dataset_properties(dataset: str):
    if not VALID_DATASET.match(dataset):
        raise HTTPException(status_code=400, detail="Invalid dataset name")
    props = [
        "used", "available", "referenced", "compressratio",
        "mountpoint", "compression", "atime", "relatime",
        "quota", "refquota", "reservation", "refreservation",
        "dedup", "recordsize", "readonly", "exec", "setuid",
        "acltype", "aclmode", "xattr", "snapdir", "sync",
        "logbias", "copies", "creation", "type",
    ]
    result = parse_zfs_get(dataset, props)
    if not result:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return result


@router.post("")
def create_dataset(req: DatasetCreateRequest, username: str = Depends(get_current_admin)):
    if not VALID_DATASET.match(req.name):
        raise HTTPException(status_code=400, detail="Invalid dataset name")

    cmd = ["zfs", "create"]
    for key, value in req.properties.items():
        if key not in EDITABLE_PROPERTIES:
            raise HTTPException(status_code=400, detail=f"Property not allowed: {key}")
        if re.search(r"[\n\r;|&$`]", value):
            raise HTTPException(status_code=400, detail=f"Invalid characters in property value for '{key}'")
        cmd.extend(["-o", f"{key}={value}"])
    cmd.append(req.name)

    result = run(cmd)
    if not result.ok:
        raise HTTPException(status_code=500, detail=result.stderr.strip())

    logger.info(f"User '{username}' created dataset '{req.name}'")
    return {"message": f"Dataset '{req.name}' created"}


@router.put("/{dataset:path}")
def update_dataset(dataset: str, req: DatasetUpdateRequest, username: str = Depends(get_current_admin)):
    if not VALID_DATASET.match(dataset):
        raise HTTPException(status_code=400, detail="Invalid dataset name")

    for key, value in req.properties.items():
        if key not in EDITABLE_PROPERTIES:
            raise HTTPException(status_code=400, detail=f"Property not allowed: {key}")
        if re.search(r"[\n\r;|&$`]", value):
            raise HTTPException(status_code=400, detail=f"Invalid characters in property value for '{key}'")
        result = run(["zfs", "set", f"{key}={value}", dataset])
        if not result.ok:
            raise HTTPException(status_code=500, detail=result.stderr.strip())

    logger.info(f"User '{username}' updated dataset '{dataset}' properties: {req.properties}")
    return {"message": f"Dataset '{dataset}' updated"}


@router.delete("/{dataset:path}")
def delete_dataset(dataset: str, recursive: bool = False, username: str = Depends(get_current_admin)):
    if not VALID_DATASET.match(dataset):
        raise HTTPException(status_code=400, detail="Invalid dataset name")

    cmd = ["zfs", "destroy"]
    if recursive:
        cmd.append("-r")
    cmd.append(dataset)

    result = run(cmd, timeout=60)
    if not result.ok:
        raise HTTPException(status_code=500, detail=result.stderr.strip())

    logger.info(f"User '{username}' destroyed dataset '{dataset}' (recursive={recursive})")
    return {"message": f"Dataset '{dataset}' destroyed"}
