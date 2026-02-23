import json
import logging

from fastapi import APIRouter, Depends, HTTPException

from backend.utils.auth import get_current_user
from backend.utils.shell import run

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/disks", tags=["disks"], dependencies=[Depends(get_current_user)])


@router.get("")
def list_disks():
    result = run(["lsblk", "-d", "-o", "NAME,SIZE,TYPE,MODEL,SERIAL,ROTA,TRAN", "-J"])
    if not result.ok:
        # Fallback to non-JSON
        result = run(["lsblk", "-d", "-n", "-o", "NAME,SIZE,TYPE,MODEL", "-e", "7,11"])
        if not result.ok:
            return []
        disks = []
        for line in result.stdout.strip().splitlines():
            parts = line.split(None, 3)
            if len(parts) >= 3 and parts[2] == "disk":
                disks.append({
                    "name": parts[0],
                    "size": parts[1],
                    "type": parts[2],
                    "model": parts[3].strip() if len(parts) > 3 else "",
                })
        return disks

    try:
        data = json.loads(result.stdout)
        return [d for d in data.get("blockdevices", []) if d.get("type") == "disk"]
    except json.JSONDecodeError:
        return []


@router.get("/{disk}/smart")
def disk_smart(disk: str):
    if not disk.replace("-", "").replace("_", "").isalnum():
        raise HTTPException(status_code=400, detail="Invalid disk name")

    result = run(["smartctl", "-a", "-j", f"/dev/{disk}"])
    if result.stdout:
        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError:
            pass

    # Fallback to text output
    result = run(["smartctl", "-a", f"/dev/{disk}"])
    if result.returncode == -1:
        return {"error": "SMART not available", "detail": result.stderr}
    return {"raw": result.stdout, "returncode": result.returncode}


@router.get("/{disk}/temperature")
def disk_temperature(disk: str):
    if not disk.replace("-", "").replace("_", "").isalnum():
        raise HTTPException(status_code=400, detail="Invalid disk name")

    result = run(["smartctl", "-A", "-j", f"/dev/{disk}"])
    if result.stdout:
        try:
            data = json.loads(result.stdout)
            temp = data.get("temperature", {}).get("current")
            return {"disk": disk, "temperature": temp}
        except json.JSONDecodeError:
            pass
    return {"disk": disk, "temperature": None}


@router.post("/{disk}/test/{test_type}")
def start_smart_test(disk: str, test_type: str, username: str = Depends(get_current_user)):
    if not disk.replace("-", "").replace("_", "").isalnum():
        raise HTTPException(status_code=400, detail="Invalid disk name")
    if test_type not in ("short", "long", "conveyance"):
        raise HTTPException(status_code=400, detail="Invalid test type")

    result = run(["smartctl", "-t", test_type, f"/dev/{disk}"])
    logger.info(f"User '{username}' started SMART {test_type} test on {disk}")
    return {"message": f"SMART {test_type} test started on {disk}", "output": result.stdout}
