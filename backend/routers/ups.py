import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import subprocess

from backend.utils.auth import get_current_user
from backend.utils.shell import run

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ups", tags=["ups"], dependencies=[Depends(get_current_user)])

NUT_CONF = "/etc/nut/nut.conf"
UPS_CONF = "/etc/nut/ups.conf"
UPSMON_CONF = "/etc/nut/upsmon.conf"


def _nsenter(*args) -> "ShellResult":
    return run(["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--", *args])


def _is_installed() -> bool:
    result = _nsenter("which", "upsc")
    return result.ok


def _read_file(path: str) -> str:
    result = _nsenter("cat", path)
    return result.stdout if result.ok else ""


def _parse_kv(text: str) -> dict:
    config = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, _, value = line.partition("=")
            config[key.strip()] = value.strip().strip('"')
    return config


class UPSConfig(BaseModel):
    mode: str = "standalone"
    driver: str = "usbhid-ups"
    port: str = "auto"
    ups_name: str = "ups"
    monitor_host: str = "localhost"
    monitor_user: str = "upsmon"
    monitor_password: str = "secret"
    shutdown_cmd: str = "/sbin/shutdown -h +0"
    powerdown_flag: str = "/etc/killpower"


@router.get("/config")
def get_config():
    if not _is_installed():
        return {"installed": False, "config": UPSConfig().model_dump()}

    nut_raw = _parse_kv(_read_file(NUT_CONF))
    ups_raw = _read_file(UPS_CONF)
    upsmon_raw = _read_file(UPSMON_CONF)

    # Parse ups.conf for first UPS section
    ups_name = "ups"
    driver = "usbhid-ups"
    port = "auto"
    in_section = False
    for line in ups_raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]"):
            ups_name = line[1:-1]
            in_section = True
            continue
        if in_section and "=" in line:
            k, _, v = line.partition("=")
            k, v = k.strip(), v.strip().strip('"')
            if k == "driver":
                driver = v
            elif k == "port":
                port = v

    # Parse upsmon.conf
    monitor_host = "localhost"
    monitor_user = "upsmon"
    monitor_password = "secret"
    shutdown_cmd = "/sbin/shutdown -h +0"
    powerdown_flag = "/etc/killpower"
    for line in upsmon_raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("MONITOR"):
            parts = line.split()
            if len(parts) >= 5:
                host_part = parts[1]
                if "@" in host_part:
                    monitor_host = host_part.split("@")[1]
                monitor_user = parts[3]
                monitor_password = parts[4]
        elif line.startswith("SHUTDOWNCMD"):
            shutdown_cmd = line.partition(" ")[2].strip().strip('"')
        elif line.startswith("POWERDOWNFLAG"):
            powerdown_flag = line.partition(" ")[2].strip().strip('"')

    config = UPSConfig(
        mode=nut_raw.get("MODE", "standalone").lower(),
        driver=driver,
        port=port,
        ups_name=ups_name,
        monitor_host=monitor_host,
        monitor_user=monitor_user,
        monitor_password=monitor_password,
        shutdown_cmd=shutdown_cmd,
        powerdown_flag=powerdown_flag,
    )
    return {"installed": True, "config": config.model_dump()}


@router.put("/config")
def save_config(body: UPSConfig, username: str = Depends(get_current_user)):
    if not _is_installed():
        raise HTTPException(status_code=400, detail="NUT (UPS) is not installed")

    if body.mode not in ("standalone", "netserver", "netclient"):
        raise HTTPException(status_code=400, detail=f"Invalid mode: {body.mode}")

    # Write nut.conf
    nut_content = f'MODE={body.mode}\n'
    _write_file(NUT_CONF, nut_content)

    # Write ups.conf
    ups_content = f'[{body.ups_name}]\n  driver = {body.driver}\n  port = {body.port}\n'
    _write_file(UPS_CONF, ups_content)

    # Write upsmon.conf
    upsmon_content = (
        f'MONITOR {body.ups_name}@{body.monitor_host} 1 {body.monitor_user} {body.monitor_password} master\n'
        f'SHUTDOWNCMD "{body.shutdown_cmd}"\n'
        f'POWERDOWNFLAG {body.powerdown_flag}\n'
    )
    _write_file(UPSMON_CONF, upsmon_content)

    restart = _nsenter("systemctl", "restart", "nut-monitor")
    if not restart.ok:
        logger.warning(f"Failed to restart nut-monitor: {restart.stderr}")

    logger.info(f"User '{username}' updated UPS configuration")
    return {"message": "UPS configuration saved"}


@router.get("/status")
def get_status():
    if not _is_installed():
        return {"installed": False, "status": None}

    # Get UPS name from config
    ups_raw = _read_file(UPS_CONF)
    ups_name = "ups"
    for line in ups_raw.splitlines():
        line = line.strip()
        if line.startswith("[") and line.endswith("]"):
            ups_name = line[1:-1]
            break

    result = _nsenter("upsc", f"{ups_name}@localhost")
    if not result.ok:
        return {"installed": True, "status": None, "error": "Could not query UPS status"}

    status = {}
    for line in result.stdout.splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            status[key.strip()] = value.strip()

    return {
        "installed": True,
        "status": {
            "battery_charge": status.get("battery.charge", "N/A"),
            "battery_runtime": status.get("battery.runtime", "N/A"),
            "ups_load": status.get("ups.load", "N/A"),
            "ups_status": status.get("ups.status", "N/A"),
            "input_voltage": status.get("input.voltage", "N/A"),
            "output_voltage": status.get("output.voltage", "N/A"),
            "ups_model": status.get("ups.model", "N/A"),
            "ups_mfr": status.get("ups.mfr", "N/A"),
        },
    }


def _write_file(path: str, content: str):
    proc = subprocess.run(
        ["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--",
         "tee", path],
        input=content, capture_output=True, text=True, timeout=10,
    )
    if proc.returncode != 0:
        raise HTTPException(status_code=500, detail=f"Failed to write {path}: {proc.stderr}")
