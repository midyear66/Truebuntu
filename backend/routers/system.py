import logging
import re

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from backend.utils.auth import get_current_admin
from backend.utils.shell import run

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/system", tags=["system"], dependencies=[Depends(get_current_admin)])

HOSTNAME_RE = re.compile(r"^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?$")
CHRONY_CONF = "/etc/chrony/chrony.conf"


class GeneralUpdate(BaseModel):
    hostname: str | None = None
    timezone: str | None = None


class NTPServer(BaseModel):
    address: str
    iburst: bool = True
    prefer: bool = False


# --- General ---

@router.get("/general")
def get_general(username: str = Depends(get_current_admin)):
    hostname_result = run([
        "nsenter", "-t", "1", "-m", "-u", "-n", "-i",
        "hostnamectl", "--static",
    ])
    hostname = hostname_result.stdout.strip() if hostname_result.ok else "unknown"

    tz_result = run([
        "nsenter", "-t", "1", "-m", "-u", "-n", "-i",
        "timedatectl", "show", "-p", "Timezone", "--value",
    ])
    timezone = tz_result.stdout.strip() if tz_result.ok else "UTC"

    tz_list_result = run([
        "nsenter", "-t", "1", "-m", "-u", "-n", "-i",
        "timedatectl", "list-timezones",
    ])
    available_timezones = (
        tz_list_result.stdout.strip().splitlines() if tz_list_result.ok else []
    )

    return {
        "hostname": hostname,
        "timezone": timezone,
        "available_timezones": available_timezones,
    }


@router.put("/general")
def update_general(body: GeneralUpdate, username: str = Depends(get_current_admin)):
    results = {}

    if body.hostname is not None:
        if not HOSTNAME_RE.match(body.hostname):
            raise HTTPException(status_code=400, detail="Invalid hostname (RFC 1123)")
        result = run([
            "nsenter", "-t", "1", "-m", "-u", "-n", "-i",
            "hostnamectl", "set-hostname", body.hostname,
        ])
        if not result.ok:
            raise HTTPException(status_code=500, detail=f"Failed to set hostname: {result.stderr.strip()}")
        results["hostname"] = body.hostname

    if body.timezone is not None:
        # Validate against available timezones
        tz_list = run([
            "nsenter", "-t", "1", "-m", "-u", "-n", "-i",
            "timedatectl", "list-timezones",
        ])
        if tz_list.ok:
            valid = body.timezone in tz_list.stdout.strip().splitlines()
            if not valid:
                raise HTTPException(status_code=400, detail="Invalid timezone")

        result = run([
            "nsenter", "-t", "1", "-m", "-u", "-n", "-i",
            "timedatectl", "set-timezone", body.timezone,
        ])
        if not result.ok:
            raise HTTPException(status_code=500, detail=f"Failed to set timezone: {result.stderr.strip()}")
        results["timezone"] = body.timezone

    return {"updated": results}


# --- NTP ---

def _parse_chrony_conf() -> list[dict]:
    """Parse NTP server/pool entries from chrony.conf."""
    servers = []
    try:
        with open(CHRONY_CONF, "r") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                parts = line.split()
                if parts[0] in ("server", "pool") and len(parts) >= 2:
                    servers.append({
                        "address": parts[1],
                        "iburst": "iburst" in parts[2:],
                        "prefer": "prefer" in parts[2:],
                    })
    except FileNotFoundError:
        logger.warning(f"{CHRONY_CONF} not found")
    return servers


def _write_ntp_servers(servers: list[dict]):
    """Rewrite chrony.conf preserving non-server lines, replacing server/pool entries."""
    non_server_lines = []
    try:
        with open(CHRONY_CONF, "r") as f:
            for line in f:
                stripped = line.strip()
                parts = stripped.split()
                if parts and parts[0] in ("server", "pool"):
                    continue
                non_server_lines.append(line)
    except FileNotFoundError:
        non_server_lines = []

    with open(CHRONY_CONF, "w") as f:
        for line in non_server_lines:
            f.write(line)
        for s in servers:
            entry = f"server {s['address']}"
            if s.get("iburst"):
                entry += " iburst"
            if s.get("prefer"):
                entry += " prefer"
            f.write(entry + "\n")


def _restart_chrony():
    result = run([
        "nsenter", "-t", "1", "-m", "-u", "-n", "-i",
        "systemctl", "restart", "chrony",
    ])
    if not result.ok:
        logger.warning(f"Failed to restart chrony: {result.stderr.strip()}")


@router.get("/ntp")
def get_ntp(username: str = Depends(get_current_admin)):
    return _parse_chrony_conf()


@router.post("/ntp")
def add_ntp(body: NTPServer, username: str = Depends(get_current_admin)):
    servers = _parse_chrony_conf()
    for s in servers:
        if s["address"] == body.address:
            raise HTTPException(status_code=400, detail="NTP server already exists")

    servers.append({"address": body.address, "iburst": body.iburst, "prefer": body.prefer})
    _write_ntp_servers(servers)
    _restart_chrony()
    return {"message": f"Added NTP server {body.address}"}


@router.delete("/ntp/{address:path}")
def remove_ntp(address: str, username: str = Depends(get_current_admin)):
    servers = _parse_chrony_conf()
    new_servers = [s for s in servers if s["address"] != address]
    if len(new_servers) == len(servers):
        raise HTTPException(status_code=404, detail="NTP server not found")

    _write_ntp_servers(new_servers)
    _restart_chrony()
    return {"message": f"Removed NTP server {address}"}
