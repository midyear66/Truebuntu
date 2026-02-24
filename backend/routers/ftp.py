import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import subprocess

from backend.utils.auth import get_current_user
from backend.utils.shell import run

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ftp", tags=["ftp"], dependencies=[Depends(get_current_user)])

CONFIG_FILE = "/etc/vsftpd.conf"


def _nsenter(*args) -> "ShellResult":
    return run(["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--", *args])


def _is_installed() -> bool:
    result = _nsenter("which", "vsftpd")
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


def _bool_val(raw: dict, key: str, default: bool = False) -> bool:
    val = raw.get(key, "")
    if val.upper() in ("YES", "TRUE", "1"):
        return True
    if val.upper() in ("NO", "FALSE", "0"):
        return False
    return default


class FTPConfig(BaseModel):
    listen_port: int = 21
    max_clients: int = 200
    max_per_ip: int = 0
    idle_session_timeout: int = 300
    anonymous_enable: bool = False
    local_enable: bool = True
    write_enable: bool = True
    chroot_local_user: bool = True
    ssl_enable: bool = False
    allow_writeable_chroot: bool = True
    pasv_min_port: int = 0
    pasv_max_port: int = 0
    local_umask: str = "022"


@router.get("/config")
def get_config():
    if not _is_installed():
        return {"installed": False, "config": FTPConfig().model_dump()}
    raw = _read_config()
    config = FTPConfig(
        listen_port=int(raw.get("listen_port", "21")),
        max_clients=int(raw.get("max_clients", "200")),
        max_per_ip=int(raw.get("max_per_ip", "0")),
        idle_session_timeout=int(raw.get("idle_session_timeout", "300")),
        anonymous_enable=_bool_val(raw, "anonymous_enable", False),
        local_enable=_bool_val(raw, "local_enable", True),
        write_enable=_bool_val(raw, "write_enable", True),
        chroot_local_user=_bool_val(raw, "chroot_local_user", True),
        ssl_enable=_bool_val(raw, "ssl_enable", False),
        allow_writeable_chroot=_bool_val(raw, "allow_writeable_chroot", True),
        pasv_min_port=int(raw.get("pasv_min_port", "0")),
        pasv_max_port=int(raw.get("pasv_max_port", "0")),
        local_umask=raw.get("local_umask", "022"),
    )
    return {"installed": True, "config": config.model_dump()}


@router.put("/config")
def save_config(body: FTPConfig, username: str = Depends(get_current_user)):
    if not _is_installed():
        raise HTTPException(status_code=400, detail="vsftpd is not installed")

    def yn(v: bool) -> str:
        return "YES" if v else "NO"

    lines = [
        f"listen=YES",
        f"listen_port={body.listen_port}",
        f"max_clients={body.max_clients}",
        f"max_per_ip={body.max_per_ip}",
        f"idle_session_timeout={body.idle_session_timeout}",
        f"anonymous_enable={yn(body.anonymous_enable)}",
        f"local_enable={yn(body.local_enable)}",
        f"write_enable={yn(body.write_enable)}",
        f"chroot_local_user={yn(body.chroot_local_user)}",
        f"ssl_enable={yn(body.ssl_enable)}",
        f"allow_writeable_chroot={yn(body.allow_writeable_chroot)}",
        f"pasv_min_port={body.pasv_min_port}",
        f"pasv_max_port={body.pasv_max_port}",
        f"local_umask={body.local_umask}",
    ]
    content = "\n".join(lines) + "\n"

    proc = subprocess.run(
        ["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--",
         "tee", CONFIG_FILE],
        input=content, capture_output=True, text=True, timeout=10,
    )
    if proc.returncode != 0:
        raise HTTPException(status_code=500, detail=f"Failed to write config: {proc.stderr}")

    restart = _nsenter("systemctl", "restart", "vsftpd")
    if not restart.ok:
        logger.warning(f"Failed to restart vsftpd: {restart.stderr}")

    logger.info(f"User '{username}' updated FTP configuration")
    return {"message": "FTP configuration saved"}
