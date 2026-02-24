import json
import logging
import re

from fastapi import APIRouter, Depends, HTTPException

from backend.utils.auth import get_current_user
from backend.utils.shell import run
from backend.utils.zfs import get_boot_disk, get_pool_disk_roles

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/disks", tags=["disks"], dependencies=[Depends(get_current_user)])

# Run disk-wipe commands in the host's mount namespace so that
# device nodes removed by udev are reflected immediately.
NSENTER = ["nsenter", "-t", "1", "-m", "--"]


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


@router.get("/{disk}/identify")
def identify_disk(disk: str):
    """Show what's currently on a disk before wiping — signatures, partitions, mount status."""
    if not disk.replace("-", "").replace("_", "").isalnum():
        raise HTTPException(status_code=400, detail="Invalid disk name")

    signatures = []
    partitions = []
    mounted = False

    # Get partition and mount info via lsblk
    lsblk_result = run(["lsblk", "-J", "-o", "NAME,SIZE,FSTYPE,LABEL,MOUNTPOINT", f"/dev/{disk}"])
    if lsblk_result.ok:
        try:
            data = json.loads(lsblk_result.stdout)
            for dev in data.get("blockdevices", []):
                if dev.get("mountpoint"):
                    mounted = True
                for child in dev.get("children", []):
                    partitions.append({
                        "name": child.get("name", ""),
                        "size": child.get("size", ""),
                        "fstype": child.get("fstype") or "",
                        "label": child.get("label") or "",
                        "mountpoint": child.get("mountpoint") or "",
                    })
                    if child.get("mountpoint"):
                        mounted = True
        except json.JSONDecodeError:
            pass

    # Get filesystem signatures via blkid on the disk itself
    blkid_result = run(["blkid", f"/dev/{disk}"])
    if blkid_result.ok and blkid_result.stdout.strip():
        sig = _parse_blkid_line(blkid_result.stdout.strip(), f"/dev/{disk}")
        if sig:
            signatures.append(sig)

    # Also check each partition
    for part in partitions:
        blkid_result = run(["blkid", f"/dev/{part['name']}"])
        if blkid_result.ok and blkid_result.stdout.strip():
            sig = _parse_blkid_line(blkid_result.stdout.strip(), f"/dev/{part['name']}")
            if sig:
                signatures.append(sig)

    return {
        "disk": disk,
        "signatures": signatures,
        "partitions": partitions,
        "mounted": mounted,
    }


def _parse_blkid_line(line: str, device: str) -> dict | None:
    """Parse a blkid output line into a signature dict."""
    sig = {"device": device, "type": "", "label": ""}
    type_match = re.search(r'TYPE="([^"]*)"', line)
    label_match = re.search(r'LABEL="([^"]*)"', line)
    if type_match:
        sig["type"] = type_match.group(1)
    if label_match:
        sig["label"] = label_match.group(1)
    if type_match or label_match:
        return sig
    return None


@router.post("/{disk}/prepare")
def prepare_disk(disk: str, username: str = Depends(get_current_user)):
    """Wipe filesystem signatures and partition tables to prepare a disk for ZFS use."""
    if not disk.replace("-", "").replace("_", "").isalnum():
        raise HTTPException(status_code=400, detail="Invalid disk name")

    # Safety: reject boot disk
    boot_disk = get_boot_disk()
    if boot_disk and disk == boot_disk:
        raise HTTPException(status_code=400, detail="Cannot wipe the boot disk")

    # Safety: reject disks in ZFS pools (data/log/cache roles)
    pool_roles = get_pool_disk_roles()
    for pool, roles in pool_roles.items():
        for role in ("data", "log", "cache"):
            if disk in roles.get(role, []):
                raise HTTPException(
                    status_code=400,
                    detail=f"Disk is in use by pool '{pool}' as {role}",
                )

    # Safety: reject mounted disks
    lsblk_result = run(["lsblk", "-J", "-o", "NAME,MOUNTPOINT", f"/dev/{disk}"])
    if lsblk_result.ok:
        try:
            data = json.loads(lsblk_result.stdout)
            for dev in data.get("blockdevices", []):
                if dev.get("mountpoint"):
                    raise HTTPException(status_code=400, detail=f"Disk {disk} is mounted")
                for child in dev.get("children", []):
                    if child.get("mountpoint"):
                        raise HTTPException(
                            status_code=400,
                            detail=f"Partition {child['name']} is mounted",
                        )
        except json.JSONDecodeError:
            pass

    # Wipe filesystem signatures (via host mount namespace for udev visibility)
    result = run(NSENTER + ["wipefs", "--all", "--force", f"/dev/{disk}"])
    if not result.ok:
        raise HTTPException(status_code=500, detail=f"wipefs failed: {result.stderr}")

    # Destroy GPT and MBR partition tables
    result = run(NSENTER + ["sgdisk", "--zap-all", f"/dev/{disk}"])
    if not result.ok:
        raise HTTPException(status_code=500, detail=f"sgdisk failed: {result.stderr}")

    # Force kernel to re-read the (now empty) partition table
    run(NSENTER + ["blockdev", "--rereadpt", f"/dev/{disk}"])

    logger.info(f"User '{username}' prepared disk {disk} (wiped signatures and partition tables)")
    return {"message": f"Disk {disk} has been wiped and prepared for use"}
