import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from backend.utils.auth import get_current_admin
from backend.utils.shell import run

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ddns", tags=["ddns"], dependencies=[Depends(get_current_admin)])

CONFIG_FILE = "/etc/ddclient.conf"

PROVIDERS = ["dyndns2", "cloudflare", "namecheap", "google", "freedns", "custom"]


def _nsenter(*args) -> "ShellResult":
    return run(["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--", *args])


def _is_installed() -> bool:
    result = _nsenter("which", "ddclient")
    return result.ok


def _read_config() -> dict:
    result = _nsenter("cat", CONFIG_FILE)
    if not result.ok:
        return {}
    config = {}
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, _, value = line.partition("=")
            config[key.strip()] = value.strip()
    return config


class DDNSConfig(BaseModel):
    provider: str = "dyndns2"
    server: str = ""
    protocol: str = "dyndns2"
    login: str = ""
    password: str = ""
    domain: str = ""
    ssl: bool = True
    update_interval: int = 300


@router.get("/config")
def get_config():
    if not _is_installed():
        return {"installed": False, "config": DDNSConfig().model_dump()}
    raw = _read_config()
    config = DDNSConfig(
        provider=raw.get("protocol", "dyndns2"),
        server=raw.get("server", ""),
        protocol=raw.get("protocol", "dyndns2"),
        login=raw.get("login", ""),
        password=raw.get("password", ""),
        domain=raw.get("domain", raw.get("zone", "")),
        ssl=raw.get("ssl", "yes").lower() in ("yes", "true", "1"),
        update_interval=int(raw.get("daemon", "300")),
    )
    return {"installed": True, "config": config.model_dump()}


@router.put("/config")
def save_config(body: DDNSConfig, username: str = Depends(get_current_admin)):
    if not _is_installed():
        raise HTTPException(status_code=400, detail="ddclient is not installed")

    if body.provider not in PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Invalid provider: {body.provider}")

    # Reject newlines in all string fields
    for field_name in ("server", "protocol", "login", "password", "domain"):
        val = getattr(body, field_name)
        if "\n" in val or "\r" in val:
            raise HTTPException(status_code=400, detail=f"Newlines not allowed in {field_name}")

    # Escape single quotes in password to prevent config injection
    safe_password = body.password.replace("'", "'\\''")

    lines = [
        f"protocol={body.protocol}",
        f"server={body.server}" if body.server else None,
        f"login={body.login}",
        f"password='{safe_password}'",
        f"ssl={'yes' if body.ssl else 'no'}",
        f"daemon={body.update_interval}",
        f"{body.domain}",
    ]
    content = "\n".join(l for l in lines if l is not None) + "\n"

    import subprocess
    proc = subprocess.run(
        ["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--",
         "tee", CONFIG_FILE],
        input=content, capture_output=True, text=True, timeout=10,
    )
    if proc.returncode != 0:
        raise HTTPException(status_code=500, detail=f"Failed to write config: {proc.stderr}")

    restart = _nsenter("systemctl", "restart", "ddclient")
    if not restart.ok:
        logger.warning(f"Failed to restart ddclient: {restart.stderr}")

    logger.info(f"User '{username}' updated DDNS configuration")
    return {"message": "DDNS configuration saved"}
