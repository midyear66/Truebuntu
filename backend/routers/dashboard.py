import json
import logging

from fastapi import APIRouter, Depends

from backend.database import get_db
from backend.utils.auth import get_current_user
from backend.utils.shell import run
from backend.utils.zfs import parse_zpool_list, parse_zfs_list, list_snapshots

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/dashboard", tags=["dashboard"], dependencies=[Depends(get_current_user)])


@router.get("")
def dashboard():
    return {
        "hostname": _get_hostname(),
        "uptime": _get_uptime(),
        "pools": parse_zpool_list(),
        "datasets": parse_zfs_list(),
        "recent_snapshots": list_snapshots()[-10:],
        "services": _get_service_states(),
        "disk_temps": _get_disk_temps(),
        "upcoming_tasks": _get_upcoming_tasks(),
    }


def _get_hostname() -> str:
    result = run(["hostname"])
    return result.stdout.strip() if result.ok else "unknown"


def _get_uptime() -> str:
    result = run(["uptime", "-p"])
    return result.stdout.strip() if result.ok else "unknown"


def _get_service_states() -> list[dict]:
    services = ["smbd", "nmbd", "nfs-kernel-server", "ssh", "docker"]
    states = []
    for name in services:
        result = run(["systemctl", "is-active", name])
        states.append({
            "name": name,
            "active": result.stdout.strip(),
        })
    return states


def _get_disk_temps() -> list[dict]:
    result = run(["lsblk", "-d", "-n", "-o", "NAME,TYPE", "-e", "7,11"])
    if not result.ok:
        return []
    temps = []
    for line in result.stdout.strip().splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[1] == "disk":
            disk = parts[0]
            smart = run(["smartctl", "-A", "-j", f"/dev/{disk}"])
            temp = None
            if smart.stdout:
                try:
                    data = json.loads(smart.stdout)
                    temp = data.get("temperature", {}).get("current")
                except (json.JSONDecodeError, AttributeError):
                    pass
            temps.append({"disk": disk, "temperature": temp})
    return temps


def _get_upcoming_tasks() -> list[dict]:
    db = get_db()
    try:
        rows = db.execute(
            "SELECT id, name, type, schedule FROM tasks WHERE enabled = 1 ORDER BY id LIMIT 10"
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        db.close()
