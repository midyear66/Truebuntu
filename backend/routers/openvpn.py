import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import subprocess

from backend.utils.auth import get_current_user
from backend.utils.shell import run

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/openvpn", tags=["openvpn"], dependencies=[Depends(get_current_user)])

CLIENT_CONF = "/etc/openvpn/client.conf"
SERVER_CONF = "/etc/openvpn/server.conf"


def _nsenter(*args) -> "ShellResult":
    return run(["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--", *args])


def _is_installed() -> bool:
    result = _nsenter("which", "openvpn")
    return result.ok


def _read_file(path: str) -> str:
    result = _nsenter("cat", path)
    return result.stdout if result.ok else ""


def _write_file(path: str, content: str):
    proc = subprocess.run(
        ["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--",
         "tee", path],
        input=content, capture_output=True, text=True, timeout=10,
    )
    if proc.returncode != 0:
        raise HTTPException(status_code=500, detail=f"Failed to write {path}: {proc.stderr}")


def _parse_openvpn_conf(text: str) -> dict:
    config = {}
    inline_tag = None
    inline_content = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith(";"):
            continue
        if stripped.startswith("<") and not stripped.startswith("</"):
            inline_tag = stripped.strip("<>")
            inline_content = []
            continue
        if stripped.startswith("</") and inline_tag:
            config[inline_tag] = "\n".join(inline_content)
            inline_tag = None
            continue
        if inline_tag:
            inline_content.append(line)
            continue
        parts = stripped.split(None, 1)
        key = parts[0]
        value = parts[1] if len(parts) > 1 else "true"
        config[key] = value
    return config


class ClientConfig(BaseModel):
    remote: str = ""
    port: int = 1194
    proto: str = "udp"
    dev: str = "tun"
    auth: str = "SHA256"
    cipher: str = "AES-256-GCM"
    compress: str = ""
    nobind: bool = True
    ca: str = ""
    cert: str = ""
    key: str = ""
    additional_params: str = ""


class ServerConfig(BaseModel):
    server_network: str = "10.8.0.0 255.255.255.0"
    port: int = 1194
    proto: str = "udp"
    dev: str = "tun"
    topology: str = "subnet"
    auth: str = "SHA256"
    cipher: str = "AES-256-GCM"
    compress: str = ""
    ca: str = ""
    cert: str = ""
    key: str = ""
    dh: str = ""
    additional_params: str = ""


@router.get("/client")
def get_client_config():
    if not _is_installed():
        return {"installed": False, "config": ClientConfig().model_dump()}
    raw = _parse_openvpn_conf(_read_file(CLIENT_CONF))
    remote_parts = raw.get("remote", "").split()
    config = ClientConfig(
        remote=remote_parts[0] if remote_parts else "",
        port=int(remote_parts[1]) if len(remote_parts) > 1 else int(raw.get("port", "1194")),
        proto=raw.get("proto", "udp"),
        dev=raw.get("dev", "tun"),
        auth=raw.get("auth", "SHA256"),
        cipher=raw.get("cipher", "AES-256-GCM"),
        compress=raw.get("compress", ""),
        nobind="nobind" in raw,
        ca=raw.get("ca", ""),
        cert=raw.get("cert", ""),
        key=raw.get("key", ""),
    )
    return {"installed": True, "config": config.model_dump()}


@router.put("/client")
def save_client_config(body: ClientConfig, username: str = Depends(get_current_user)):
    if not _is_installed():
        raise HTTPException(status_code=400, detail="OpenVPN is not installed")

    lines = [
        "client",
        f"remote {body.remote} {body.port}",
        f"proto {body.proto}",
        f"dev {body.dev}",
        f"auth {body.auth}",
        f"cipher {body.cipher}",
    ]
    if body.compress:
        lines.append(f"compress {body.compress}")
    if body.nobind:
        lines.append("nobind")
    if body.ca:
        lines.append(f"<ca>\n{body.ca}\n</ca>")
    if body.cert:
        lines.append(f"<cert>\n{body.cert}\n</cert>")
    if body.key:
        lines.append(f"<key>\n{body.key}\n</key>")
    if body.additional_params:
        lines.append(body.additional_params)

    content = "\n".join(lines) + "\n"
    _write_file(CLIENT_CONF, content)

    logger.info(f"User '{username}' updated OpenVPN client configuration")
    return {"message": "OpenVPN client configuration saved"}


@router.get("/server")
def get_server_config():
    if not _is_installed():
        return {"installed": False, "config": ServerConfig().model_dump()}
    raw = _parse_openvpn_conf(_read_file(SERVER_CONF))
    config = ServerConfig(
        server_network=raw.get("server", "10.8.0.0 255.255.255.0"),
        port=int(raw.get("port", "1194")),
        proto=raw.get("proto", "udp"),
        dev=raw.get("dev", "tun"),
        topology=raw.get("topology", "subnet"),
        auth=raw.get("auth", "SHA256"),
        cipher=raw.get("cipher", "AES-256-GCM"),
        compress=raw.get("compress", ""),
        ca=raw.get("ca", ""),
        cert=raw.get("cert", ""),
        key=raw.get("key", ""),
        dh=raw.get("dh", ""),
    )
    return {"installed": True, "config": config.model_dump()}


@router.put("/server")
def save_server_config(body: ServerConfig, username: str = Depends(get_current_user)):
    if not _is_installed():
        raise HTTPException(status_code=400, detail="OpenVPN is not installed")

    lines = [
        f"server {body.server_network}",
        f"port {body.port}",
        f"proto {body.proto}",
        f"dev {body.dev}",
        f"topology {body.topology}",
        f"auth {body.auth}",
        f"cipher {body.cipher}",
    ]
    if body.compress:
        lines.append(f"compress {body.compress}")
    if body.ca:
        lines.append(f"<ca>\n{body.ca}\n</ca>")
    if body.cert:
        lines.append(f"<cert>\n{body.cert}\n</cert>")
    if body.key:
        lines.append(f"<key>\n{body.key}\n</key>")
    if body.dh:
        lines.append(f"<dh>\n{body.dh}\n</dh>")
    if body.additional_params:
        lines.append(body.additional_params)

    content = "\n".join(lines) + "\n"
    _write_file(SERVER_CONF, content)

    logger.info(f"User '{username}' updated OpenVPN server configuration")
    return {"message": "OpenVPN server configuration saved"}
