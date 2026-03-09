import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import subprocess

from backend.utils.auth import get_current_admin
from backend.utils.shell import run

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/snmp", tags=["snmp"], dependencies=[Depends(get_current_admin)])

VALID_V3_USERNAME = re.compile(r"^[a-zA-Z0-9_.-]+$")

CONFIG_FILE = "/etc/snmp/snmpd.conf"


def _nsenter(*args) -> "ShellResult":
    return run(["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--", *args])


def _is_installed() -> bool:
    result = _nsenter("which", "snmpd")
    return result.ok


def _read_config() -> str:
    result = _nsenter("cat", CONFIG_FILE)
    return result.stdout if result.ok else ""


class SNMPConfig(BaseModel):
    location: str = ""
    contact: str = ""
    community: str = "public"
    agent_address: str = "udp:161"
    v3_enabled: bool = False
    v3_username: str = ""
    v3_auth_type: str = "SHA"
    v3_auth_passphrase: str = ""
    v3_privacy_protocol: str = "AES"
    v3_privacy_passphrase: str = ""
    log_level: str = "0"


@router.get("/config")
def get_config():
    if not _is_installed():
        return {"installed": False, "config": SNMPConfig().model_dump()}

    raw = _read_config()
    config = SNMPConfig()

    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("sysLocation"):
            config.location = line.partition(" ")[2].strip()
        elif line.startswith("sysContact"):
            config.contact = line.partition(" ")[2].strip()
        elif line.startswith("rocommunity ") or line.startswith("rwcommunity "):
            config.community = line.split()[1] if len(line.split()) > 1 else "public"
        elif line.startswith("agentaddress") or line.startswith("agentAddress"):
            config.agent_address = line.partition(" ")[2].strip()
        elif line.startswith("createUser"):
            parts = line.split()
            config.v3_enabled = True
            if len(parts) >= 2:
                config.v3_username = parts[1]
            if len(parts) >= 3:
                config.v3_auth_type = parts[2]
            if len(parts) >= 4:
                config.v3_auth_passphrase = parts[3]
            if len(parts) >= 5:
                config.v3_privacy_protocol = parts[4]
            if len(parts) >= 6:
                config.v3_privacy_passphrase = parts[5]

    return {"installed": True, "config": config.model_dump()}


@router.put("/config")
def save_config(body: SNMPConfig, username: str = Depends(get_current_admin)):
    if not _is_installed():
        raise HTTPException(status_code=400, detail="snmpd is not installed")

    # Reject newlines in string fields
    for field_name in ("location", "contact", "community", "agent_address",
                       "v3_username", "v3_auth_passphrase", "v3_privacy_passphrase"):
        val = getattr(body, field_name)
        if "\n" in val or "\r" in val:
            raise HTTPException(status_code=400, detail=f"Newlines not allowed in {field_name}")

    if body.v3_username and not VALID_V3_USERNAME.match(body.v3_username):
        raise HTTPException(status_code=400, detail="Invalid v3 username format")

    if body.v3_auth_type not in ("MD5", "SHA"):
        raise HTTPException(status_code=400, detail=f"Invalid auth type: {body.v3_auth_type}")
    if body.v3_privacy_protocol not in ("AES", "DES"):
        raise HTTPException(status_code=400, detail=f"Invalid privacy protocol: {body.v3_privacy_protocol}")

    lines = [
        f"sysLocation {body.location}",
        f"sysContact {body.contact}",
        f"agentaddress {body.agent_address}",
        f"rocommunity {body.community}",
    ]

    if body.v3_enabled and body.v3_username:
        create_line = f"createUser {body.v3_username} {body.v3_auth_type}"
        if body.v3_auth_passphrase:
            create_line += f" {body.v3_auth_passphrase}"
        if body.v3_privacy_protocol and body.v3_privacy_passphrase:
            create_line += f" {body.v3_privacy_protocol} {body.v3_privacy_passphrase}"
        lines.append(create_line)
        lines.append(f"rouser {body.v3_username}")

    content = "\n".join(lines) + "\n"

    proc = subprocess.run(
        ["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--",
         "tee", CONFIG_FILE],
        input=content, capture_output=True, text=True, timeout=10,
    )
    if proc.returncode != 0:
        raise HTTPException(status_code=500, detail=f"Failed to write config: {proc.stderr}")

    restart = _nsenter("systemctl", "restart", "snmpd")
    if not restart.ok:
        logger.warning(f"Failed to restart snmpd: {restart.stderr}")

    logger.info(f"User '{username}' updated SNMP configuration")
    return {"message": "SNMP configuration saved"}
