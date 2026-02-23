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
        "load_average": _get_load_average(),
        "memory": _get_memory(),
        "network": _get_network_stats(),
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
        result = run(["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--", "systemctl", "is-active", name])
        states.append({
            "name": name,
            "active": result.stdout.strip() or "unknown",
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


def _get_load_average() -> dict:
    result = run(["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--", "cat", "/proc/loadavg"])
    if not result.ok:
        return {"load1": 0, "load5": 0, "load15": 0}
    parts = result.stdout.strip().split()
    return {
        "load1": float(parts[0]) if len(parts) > 0 else 0,
        "load5": float(parts[1]) if len(parts) > 1 else 0,
        "load15": float(parts[2]) if len(parts) > 2 else 0,
    }


def _get_memory() -> dict:
    result = run(["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--", "cat", "/proc/meminfo"])
    if not result.ok:
        return {}
    info = {}
    for line in result.stdout.strip().splitlines():
        parts = line.split(":")
        if len(parts) == 2:
            key = parts[0].strip()
            val = parts[1].strip().split()[0]
            try:
                info[key] = int(val)
            except ValueError:
                pass
    total = info.get("MemTotal", 0)
    available = info.get("MemAvailable", 0)
    buffers = info.get("Buffers", 0)
    cached = info.get("Cached", 0)
    used = total - available
    percent = round((used / total) * 100, 1) if total else 0
    return {
        "total_kb": total,
        "available_kb": available,
        "used_kb": used,
        "buffers_kb": buffers,
        "cached_kb": cached,
        "percent": percent,
    }


def _get_network_stats() -> list[dict]:
    result = run(["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--", "cat", "/proc/net/dev"])
    if not result.ok:
        return []
    stats = []
    for line in result.stdout.strip().splitlines()[2:]:
        parts = line.split(":")
        if len(parts) != 2:
            continue
        iface = parts[0].strip()
        if iface == "lo":
            continue
        fields = parts[1].split()
        if len(fields) < 10:
            continue
        stats.append({
            "interface": iface,
            "rx_bytes": int(fields[0]),
            "tx_bytes": int(fields[8]),
        })
    return stats
