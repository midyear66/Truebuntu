import json
import logging

from fastapi import APIRouter, Depends

from backend.utils.auth import get_current_admin
from backend.utils.shell import run
from backend.utils.zfs import get_pool_disk_roles, _format_bytes

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/enclosure", tags=["enclosure"], dependencies=[Depends(get_current_admin)])


def _get_smart_info(device: str) -> dict:
    """Get SMART health, temperature, and power-on hours for a disk."""
    result = run(["smartctl", "-a", "-j", f"/dev/{device}"], timeout=15)
    info = {"temperature": None, "health": None, "power_on_hours": None}
    if not result.ok and not result.stdout:
        return info
    try:
        data = json.loads(result.stdout)
        info["health"] = data.get("smart_status", {}).get("passed")
        temp = data.get("temperature", {}).get("current")
        if temp is not None:
            info["temperature"] = temp
        poh = data.get("power_on_time", {}).get("hours")
        if poh is not None:
            info["power_on_hours"] = poh
    except (json.JSONDecodeError, KeyError):
        pass
    return info


@router.get("")
def get_enclosure(username: str = Depends(get_current_admin)):
    # Get all physical disks
    result = run([
        "lsblk", "-J", "-d", "-b",
        "-o", "NAME,SIZE,TYPE,MODEL,SERIAL,ROTA,TRAN",
        "-e", "7,11",
    ])
    disks = []
    if not result.ok:
        return {"disks": []}

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return {"disks": []}

    # Get pool-to-disk role mappings
    pool_roles = get_pool_disk_roles()

    # Build disk-to-pool/role lookup
    disk_pool_map = {}
    for pool_name, role_map in pool_roles.items():
        for role, disk_list in role_map.items():
            for disk in disk_list:
                disk_pool_map[disk] = {"pool": pool_name, "role": role}

    for dev in data.get("blockdevices", []):
        if dev.get("type") != "disk":
            continue
        name = dev["name"]
        smart = _get_smart_info(name)
        pool_info = disk_pool_map.get(name, {"pool": None, "role": None})
        size_bytes = dev.get("size")

        disks.append({
            "device": name,
            "model": (dev.get("model") or "").strip(),
            "serial": (dev.get("serial") or "").strip(),
            "size": _format_bytes(size_bytes) if size_bytes else "",
            "size_bytes": size_bytes or 0,
            "pool": pool_info["pool"],
            "role": pool_info["role"],
            "temperature": smart["temperature"],
            "health": smart["health"],
            "power_on_hours": smart["power_on_hours"],
        })

    return {"disks": disks}
