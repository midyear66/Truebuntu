import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.utils.auth import get_current_user, get_current_admin
from backend.utils.shell import run

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/services", tags=["services"], dependencies=[Depends(get_current_user)])

MANAGED_SERVICES = {
    "smbd", "nmbd", "nfs-kernel-server",
    "ssh", "zfs-zed", "docker",
    "zabbix-agent2", "chrony", "smartmontools",
    "vsftpd", "ddclient", "nut-monitor", "openvpn", "snmpd",
}

PROTECTED_SERVICES = {"ssh"}


def _systemctl(*args) -> "ShellResult":
    return run(["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--", "systemctl", *args])


@router.get("")
def list_services():
    services = []
    for name in sorted(MANAGED_SERVICES):
        status = _get_service_status(name)
        services.append(status)
    return services


@router.get("/{name}")
def service_detail(name: str):
    if name not in MANAGED_SERVICES:
        raise HTTPException(status_code=404, detail=f"Service '{name}' is not managed")
    return _get_service_status(name)


@router.post("/{name}/{action}")
def service_action(name: str, action: str, username: str = Depends(get_current_admin)):
    if name not in MANAGED_SERVICES:
        raise HTTPException(status_code=404, detail=f"Service '{name}' is not managed")
    if action not in ("start", "stop", "restart", "enable", "disable"):
        raise HTTPException(status_code=400, detail=f"Invalid action: {action}")
    if name in PROTECTED_SERVICES and action == "stop":
        raise HTTPException(status_code=403, detail=f"Cannot stop '{name}' remotely")

    result = _systemctl(action, name)
    if not result.ok:
        raise HTTPException(status_code=500, detail=result.stderr.strip())

    logger.info(f"User '{username}' performed '{action}' on service '{name}'")
    return {"message": f"Service '{name}' {action} successful"}


def _get_service_status(name: str) -> dict:
    active_result = _systemctl("is-active", name)
    enabled_result = _systemctl("is-enabled", name)
    return {
        "name": name,
        "active": active_result.stdout.strip(),
        "enabled": enabled_result.stdout.strip(),
    }
