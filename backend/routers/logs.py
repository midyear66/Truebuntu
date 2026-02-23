import json
import logging

from fastapi import APIRouter, Depends, Query

from backend.utils.auth import get_current_user
from backend.utils.shell import run

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/logs", tags=["logs"], dependencies=[Depends(get_current_user)])


@router.get("")
def get_logs(
    unit: str = Query("", description="Systemd unit filter"),
    priority: str = Query("", description="Priority level (0-7)"),
    lines: int = Query(100, ge=1, le=1000, description="Number of lines"),
):
    args = [
        "nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--",
        "journalctl", "--no-pager", "-n", str(lines), "-o", "json",
    ]
    if unit:
        args.extend(["-u", unit])
    if priority:
        args.extend(["-p", priority])

    result = run(args, timeout=30)
    if not result.ok:
        return []

    entries = []
    for line in result.stdout.strip().splitlines():
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
            entries.append({
                "timestamp": entry.get("__REALTIME_TIMESTAMP", ""),
                "unit": entry.get("_SYSTEMD_UNIT", entry.get("SYSLOG_IDENTIFIER", "")),
                "priority": entry.get("PRIORITY", ""),
                "message": entry.get("MESSAGE", ""),
                "hostname": entry.get("_HOSTNAME", ""),
                "pid": entry.get("_PID", ""),
            })
        except json.JSONDecodeError:
            continue

    return entries


@router.get("/units")
def get_units():
    result = run([
        "nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--",
        "systemctl", "list-units", "--type=service", "--all", "--no-pager", "--no-legend",
    ], timeout=15)
    if not result.ok:
        return []

    units = []
    for line in result.stdout.strip().splitlines():
        parts = line.split()
        if parts:
            unit = parts[0].strip()
            if unit.endswith(".service"):
                units.append(unit)
    return sorted(units)
