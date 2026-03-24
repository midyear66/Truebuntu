import logging
import re
import socket

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from backend.utils.auth import get_current_admin
from backend.utils.shell import run

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/system", tags=["system"], dependencies=[Depends(get_current_admin)])

HOSTNAME_RE = re.compile(r"^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?$")
VALID_NTP_ADDRESS = re.compile(r"^[a-zA-Z0-9._-]+$")
CHRONY_CONF = "/etc/chrony/chrony.conf"


class GeneralUpdate(BaseModel):
    hostname: str | None = None
    timezone: str | None = None


class NTPServer(BaseModel):
    address: str
    type: str = "server"  # "server" or "pool"
    iburst: bool = True
    prefer: bool = False
    minpoll: int | None = None  # log2 seconds (e.g., 6 = 64s)
    maxpoll: int | None = None  # log2 seconds (e.g., 10 = 1024s)


class NTPSettings(BaseModel):
    serve_lan: bool | None = None  # enable/disable NTP server for LAN clients


# --- Power ---

@router.post("/reboot")
def reboot_system(username: str = Depends(get_current_admin)):
    logger.info(f"User '{username}' initiated system reboot")
    result = run(["nsenter", "-t", "1", "-m", "-u", "-n", "-i", "systemctl", "reboot"])
    if not result.ok:
        raise HTTPException(status_code=500, detail=result.stderr.strip())
    return {"message": "Reboot initiated"}


@router.post("/shutdown")
def shutdown_system(username: str = Depends(get_current_admin)):
    logger.info(f"User '{username}' initiated system shutdown")
    result = run(["nsenter", "-t", "1", "-m", "-u", "-n", "-i", "systemctl", "poweroff"])
    if not result.ok:
        raise HTTPException(status_code=500, detail=result.stderr.strip())
    return {"message": "Shutdown initiated"}


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

VALID_POLL = range(0, 18)  # chrony accepts log2 values 0-17


def _ensure_chrony_active():
    """Stop systemd-timesyncd and enable chrony if not already active."""
    check = run([
        "nsenter", "-t", "1", "-m", "-u", "-n", "-i", "-p", "--",
        "systemctl", "is-active", "chrony",
    ])
    if check.ok and check.stdout.strip() == "active":
        return
    # Disable timesyncd, enable chrony
    run(["nsenter", "-t", "1", "-m", "-u", "-n", "-i", "-p", "--",
         "systemctl", "stop", "systemd-timesyncd"])
    run(["nsenter", "-t", "1", "-m", "-u", "-n", "-i", "-p", "--",
         "systemctl", "disable", "systemd-timesyncd"])
    run(["nsenter", "-t", "1", "-m", "-u", "-n", "-i", "-p", "--",
         "systemctl", "enable", "chrony"])
    result = run(["nsenter", "-t", "1", "-m", "-u", "-n", "-i", "-p", "--",
                  "systemctl", "start", "chrony"])
    if result.ok:
        logger.info("Switched from systemd-timesyncd to chrony")
    else:
        logger.warning(f"Failed to start chrony: {result.stderr.strip()}")


def _parse_chrony_conf() -> tuple[list[dict], dict]:
    """Parse chrony.conf. Returns (servers, settings)."""
    servers = []
    settings = {"serve_lan": False}
    try:
        with open(CHRONY_CONF, "r") as f:
            for line in f:
                stripped = line.strip()
                if not stripped or stripped.startswith("#"):
                    continue
                parts = stripped.split()
                if parts[0] in ("server", "pool") and len(parts) >= 2:
                    entry = {
                        "address": parts[1],
                        "type": parts[0],
                        "iburst": "iburst" in parts[2:],
                        "prefer": "prefer" in parts[2:],
                        "minpoll": None,
                        "maxpoll": None,
                    }
                    for i, p in enumerate(parts[2:], 2):
                        if p == "minpoll" and i + 1 < len(parts):
                            try:
                                entry["minpoll"] = int(parts[i + 1])
                            except (ValueError, IndexError):
                                pass
                        elif p == "maxpoll" and i + 1 < len(parts):
                            try:
                                entry["maxpoll"] = int(parts[i + 1])
                            except (ValueError, IndexError):
                                pass
                    servers.append(entry)
                elif parts[0] == "allow":
                    settings["serve_lan"] = True
    except FileNotFoundError:
        logger.warning(f"{CHRONY_CONF} not found")
    return servers, settings


def _write_chrony_conf(servers: list[dict], settings: dict):
    """Rewrite chrony.conf preserving non-server/pool/allow lines."""
    preserved_lines = []
    try:
        with open(CHRONY_CONF, "r") as f:
            for line in f:
                stripped = line.strip()
                parts = stripped.split()
                if parts and parts[0] in ("server", "pool", "allow", "local"):
                    continue
                preserved_lines.append(line)
    except FileNotFoundError:
        # Provide sensible defaults for a new config
        preserved_lines = [
            "# chrony.conf — managed by Truebuntu\n",
            "driftfile /var/lib/chrony/chrony.drift\n",
            "makestep 1.0 3\n",
            "rtcsync\n",
            "keyfile /etc/chrony/chrony.keys\n",
            "leapsectz right/UTC\n",
            "\n",
        ]

    with open(CHRONY_CONF, "w") as f:
        for line in preserved_lines:
            f.write(line)
        for s in servers:
            entry = f"{s.get('type', 'server')} {s['address']}"
            if s.get("iburst"):
                entry += " iburst"
            if s.get("prefer"):
                entry += " prefer"
            if s.get("minpoll") is not None:
                entry += f" minpoll {s['minpoll']}"
            if s.get("maxpoll") is not None:
                entry += f" maxpoll {s['maxpoll']}"
            f.write(entry + "\n")
        if settings.get("serve_lan"):
            f.write("allow\n")
            f.write("local stratum 10\n")


def _restart_chrony():
    _ensure_chrony_active()
    result = run([
        "nsenter", "-t", "1", "-m", "-u", "-n", "-i", "-p", "--",
        "systemctl", "restart", "chrony",
    ])
    if not result.ok:
        logger.warning(f"Failed to restart chrony: {result.stderr.strip()}")


def _parse_chronyc_sources() -> list[dict]:
    """Run chronyc -c sources and parse CSV output, enriching with hostnames."""
    result = run([
        "nsenter", "-t", "1", "-m", "-u", "-n", "-i", "-p", "--",
        "chronyc", "-c", "sources",
    ])
    if not result.ok:
        return []

    sources = []
    state_map = {"*": "synced", "+": "candidate", "-": "unused", "?": "unreachable", "x": "falseticker"}
    for line in result.stdout.strip().splitlines():
        fields = line.split(",")
        if len(fields) < 10:
            continue
        # CSV format: mode,state,address,stratum,poll,reach,lastRx,offset,adj_offset,error
        ip = fields[2]
        # Reverse DNS lookup for display name
        try:
            name = socket.gethostbyaddr(ip)[0]
        except (socket.herror, OSError):
            name = ip
        # Ask chrony which configured source this IP belongs to
        sn = run([
            "nsenter", "-t", "1", "-m", "-u", "-n", "-i", "-p", "--",
            "chronyc", "sourcename", ip,
        ])
        source = sn.stdout.strip() if sn.ok and sn.stdout.strip() else "—"
        sources.append({
            "mode": "server" if fields[0] == "^" else "peer" if fields[0] == "=" else fields[0],
            "state": state_map.get(fields[1], fields[1]),
            "address": ip,
            "name": name,
            "source": source,
            "stratum": int(fields[3]) if fields[3].isdigit() else 0,
            "poll": int(fields[4]) if fields[4].lstrip("-").isdigit() else 0,
            "reach": fields[5],
            "last_rx": fields[6],
            "offset": fields[7],
            "error": fields[9],
        })
    return sources


@router.get("/ntp")
def get_ntp(username: str = Depends(get_current_admin)):
    servers, settings = _parse_chrony_conf()
    sources = _parse_chronyc_sources()
    # Check if chrony is active
    check = run([
        "nsenter", "-t", "1", "-m", "-u", "-n", "-i", "-p", "--",
        "systemctl", "is-active", "chrony",
    ])
    active = check.ok and check.stdout.strip() == "active"
    return {
        "servers": servers,
        "sources": sources,
        "settings": settings,
        "active": active,
    }


@router.post("/ntp")
def add_ntp(body: NTPServer, username: str = Depends(get_current_admin)):
    if not VALID_NTP_ADDRESS.match(body.address):
        raise HTTPException(status_code=400, detail="Invalid NTP server address")
    if body.type not in ("server", "pool"):
        raise HTTPException(status_code=400, detail="Type must be 'server' or 'pool'")
    if body.minpoll is not None and body.minpoll not in VALID_POLL:
        raise HTTPException(status_code=400, detail="minpoll must be 0-17")
    if body.maxpoll is not None and body.maxpoll not in VALID_POLL:
        raise HTTPException(status_code=400, detail="maxpoll must be 0-17")
    if body.minpoll is not None and body.maxpoll is not None and body.minpoll > body.maxpoll:
        raise HTTPException(status_code=400, detail="minpoll must be <= maxpoll")

    servers, settings = _parse_chrony_conf()
    for s in servers:
        if s["address"] == body.address:
            raise HTTPException(status_code=400, detail="NTP server already exists")

    servers.append({
        "address": body.address, "type": body.type,
        "iburst": body.iburst, "prefer": body.prefer,
        "minpoll": body.minpoll, "maxpoll": body.maxpoll,
    })
    _write_chrony_conf(servers, settings)
    _restart_chrony()
    logger.info(f"User '{username}' added NTP {body.type} {body.address}")
    return {"message": f"Added NTP {body.type} {body.address}"}


@router.put("/ntp/{address:path}")
def update_ntp(address: str, body: NTPServer, username: str = Depends(get_current_admin)):
    if body.type not in ("server", "pool"):
        raise HTTPException(status_code=400, detail="Type must be 'server' or 'pool'")
    if body.minpoll is not None and body.minpoll not in VALID_POLL:
        raise HTTPException(status_code=400, detail="minpoll must be 0-17")
    if body.maxpoll is not None and body.maxpoll not in VALID_POLL:
        raise HTTPException(status_code=400, detail="maxpoll must be 0-17")
    if body.minpoll is not None and body.maxpoll is not None and body.minpoll > body.maxpoll:
        raise HTTPException(status_code=400, detail="minpoll must be <= maxpoll")

    servers, settings = _parse_chrony_conf()
    found = False
    for i, s in enumerate(servers):
        if s["address"] == address:
            servers[i] = {
                "address": body.address, "type": body.type,
                "iburst": body.iburst, "prefer": body.prefer,
                "minpoll": body.minpoll, "maxpoll": body.maxpoll,
            }
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="NTP server not found")

    _write_chrony_conf(servers, settings)
    _restart_chrony()
    logger.info(f"User '{username}' updated NTP server {address}")
    return {"message": f"Updated NTP server {address}"}


@router.delete("/ntp/{address:path}")
def remove_ntp(address: str, username: str = Depends(get_current_admin)):
    servers, settings = _parse_chrony_conf()
    new_servers = [s for s in servers if s["address"] != address]
    if len(new_servers) == len(servers):
        raise HTTPException(status_code=404, detail="NTP server not found")

    _write_chrony_conf(new_servers, settings)
    _restart_chrony()
    logger.info(f"User '{username}' removed NTP server {address}")
    return {"message": f"Removed NTP server {address}"}


@router.put("/ntp/settings")
def update_ntp_settings(body: NTPSettings, username: str = Depends(get_current_admin)):
    servers, settings = _parse_chrony_conf()
    if body.serve_lan is not None:
        settings["serve_lan"] = body.serve_lan
    _write_chrony_conf(servers, settings)
    _restart_chrony()
    logger.info(f"User '{username}' updated NTP settings: serve_lan={settings['serve_lan']}")
    return {"message": "NTP settings updated", "settings": settings}
