import json
import logging
import re
from pathlib import Path

import yaml
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from backend.utils.auth import get_current_user
from backend.utils.shell import run

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/network", tags=["network"], dependencies=[Depends(get_current_user)])

NETPLAN_FILE = "/etc/netplan/99-truebuntu.yaml"
IFACE_RE = re.compile(r"^[a-zA-Z0-9._-]+$")
IP_CIDR_RE = re.compile(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/\d{1,2}$")
IP_RE = re.compile(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$")
NSENTER = ["nsenter", "-t", "1", "-m", "-u", "-n", "-i"]

VALID_BOND_MODES = {"802.3ad", "balance-alb", "balance-tlb", "active-backup", "balance-rr", "balance-xor"}


# --- Pydantic models ---

class InterfaceConfig(BaseModel):
    dhcp: bool = True
    addresses: list[str] | None = None
    gateway: str | None = None
    mtu: int | None = None
    dns_servers: list[str] | None = None
    dns_search: list[str] | None = None


class BondCreate(BaseModel):
    name: str
    interfaces: list[str]
    mode: str
    dhcp: bool = True
    addresses: list[str] | None = None
    gateway: str | None = None
    mtu: int | None = None
    dns_servers: list[str] | None = None
    lacp_rate: str | None = None
    mii_monitor_interval: int | None = 100


class BondUpdate(BaseModel):
    interfaces: list[str] | None = None
    mode: str | None = None
    dhcp: bool | None = None
    addresses: list[str] | None = None
    gateway: str | None = None
    mtu: int | None = None
    dns_servers: list[str] | None = None
    lacp_rate: str | None = None
    mii_monitor_interval: int | None = None


# --- Helpers ---

def _validate_iface_name(name: str):
    if not IFACE_RE.match(name):
        raise HTTPException(status_code=400, detail=f"Invalid interface name: {name}")


def _validate_addresses(addresses: list[str] | None):
    if not addresses:
        return
    for addr in addresses:
        if not IP_CIDR_RE.match(addr):
            raise HTTPException(status_code=400, detail=f"Invalid CIDR address: {addr}")


def _validate_ip(ip: str | None, label: str = "IP"):
    if ip and not IP_RE.match(ip):
        raise HTTPException(status_code=400, detail=f"Invalid {label}: {ip}")


def _validate_mtu(mtu: int | None):
    if mtu is not None and (mtu < 576 or mtu > 9216):
        raise HTTPException(status_code=400, detail="MTU must be between 576 and 9216")


def _validate_dns(servers: list[str] | None):
    if not servers:
        return
    for s in servers:
        if not IP_RE.match(s):
            raise HTTPException(status_code=400, detail=f"Invalid DNS server: {s}")


def _read_netplan() -> dict:
    path = Path(NETPLAN_FILE)
    if not path.exists():
        return {"network": {"version": 2}}
    try:
        with open(path) as f:
            data = yaml.safe_load(f) or {}
        if "network" not in data:
            data["network"] = {"version": 2}
        return data
    except Exception as e:
        logger.error(f"Failed to read netplan: {e}")
        return {"network": {"version": 2}}


def _write_netplan(data: dict):
    path = Path(NETPLAN_FILE)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        yaml.dump(data, f, default_flow_style=False, sort_keys=False)


def _apply_netplan():
    result = run([*NSENTER, "netplan", "apply"], timeout=30)
    if not result.ok:
        logger.error(f"netplan apply failed: {result.stderr}")
        raise HTTPException(status_code=500, detail=f"netplan apply failed: {result.stderr.strip()}")


def _get_ip_addr() -> list[dict]:
    result = run([*NSENTER, "ip", "-j", "addr", "show"])
    if not result.ok:
        return []
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return []


def _get_ip_link() -> list[dict]:
    result = run([*NSENTER, "ip", "-j", "link", "show"])
    if not result.ok:
        return []
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return []


def _get_ethtool_info(name: str) -> dict:
    result = run([*NSENTER, "ethtool", name])
    info = {"speed": None, "duplex": None}
    if not result.ok:
        return info
    for line in result.stdout.splitlines():
        line = line.strip()
        if line.startswith("Speed:"):
            info["speed"] = line.split(":", 1)[1].strip()
        elif line.startswith("Duplex:"):
            info["duplex"] = line.split(":", 1)[1].strip()
    return info


def _get_physical_ifaces() -> set[str]:
    """Detect physical NICs by checking /sys/class/net/*/device existence."""
    result = run([*NSENTER, "cat", "/proc/net/dev"])
    if not result.ok:
        return set()
    # Get all interface names from /proc/net/dev, then test each for /sys/class/net/<name>/device
    names = set()
    for line in result.stdout.splitlines()[2:]:  # skip header lines
        name = line.split(":")[0].strip()
        if name:
            names.add(name)

    physical = set()
    for name in names:
        check = run([*NSENTER, "cat", f"/sys/class/net/{name}/device/uevent"], timeout=5)
        if check.ok:
            physical.add(name)
    return physical


def _classify_iface(name: str, link_info: dict, physical_set: set[str]) -> str:
    if name == "lo":
        return "loopback"
    # Check linkinfo from ip -j link show for bond/bridge/vlan/etc
    linkinfo = link_info.get("linkinfo", {})
    info_kind = linkinfo.get("info_kind", "")
    if info_kind == "bond":
        return "bond"
    if info_kind in ("bridge", "vlan", "veth", "tun", "tap", "dummy"):
        return "virtual"
    # Hardware-backed interface confirmed via sysfs
    if name in physical_set:
        return "physical"
    # Fallback heuristics for anything not in sysfs
    if name.startswith("veth") or name.startswith("docker") or name.startswith("br-"):
        return "virtual"
    link_type = link_info.get("link_type", "")
    if link_type == "ether":
        return "physical"
    return "virtual"


def _build_iface_list() -> list[dict]:
    addr_data = _get_ip_addr()
    link_data = _get_ip_link()
    physical_set = _get_physical_ifaces()

    link_map = {}
    for link in link_data:
        link_map[link.get("ifname", "")] = link

    interfaces = []
    for iface in addr_data:
        name = iface.get("ifname", "")
        if not name or name == "lo":
            continue
        link = link_map.get(name, {})
        addrs = []
        for ai in iface.get("addr_info", []):
            if ai.get("family") == "inet":
                addrs.append(f"{ai['local']}/{ai.get('prefixlen', '')}")
        iface_type = _classify_iface(name, link, physical_set)
        state = iface.get("operstate", "UNKNOWN")
        mac = iface.get("address", "")
        mtu = iface.get("mtu")
        ethtool = _get_ethtool_info(name) if iface_type == "physical" else {"speed": None, "duplex": None}

        interfaces.append({
            "name": name,
            "type": iface_type,
            "state": state.lower(),
            "addresses": addrs,
            "mac": mac,
            "mtu": mtu,
            "speed": ethtool["speed"],
            "duplex": ethtool["duplex"],
        })

    return interfaces


# --- Interfaces ---

@router.get("/interfaces")
def list_interfaces():
    return _build_iface_list()


@router.get("/interfaces/{name}")
def get_interface(name: str):
    _validate_iface_name(name)
    interfaces = _build_iface_list()
    for iface in interfaces:
        if iface["name"] == name:
            return iface
    raise HTTPException(status_code=404, detail=f"Interface {name} not found")


@router.get("/interfaces/{name}/config")
def get_interface_config(name: str):
    _validate_iface_name(name)
    data = _read_netplan()
    net = data.get("network", {})
    ethernets = net.get("ethernets", {})
    if name in ethernets:
        cfg = ethernets[name]
        return {
            "name": name,
            "dhcp": cfg.get("dhcp4", True),
            "addresses": cfg.get("addresses", []),
            "gateway": _extract_gateway(cfg),
            "mtu": cfg.get("mtu"),
            "dns_servers": cfg.get("nameservers", {}).get("addresses", []),
            "dns_search": cfg.get("nameservers", {}).get("search", []),
        }
    # Check bonds
    bonds = net.get("bonds", {})
    if name in bonds:
        cfg = bonds[name]
        return {
            "name": name,
            "dhcp": cfg.get("dhcp4", True),
            "addresses": cfg.get("addresses", []),
            "gateway": _extract_gateway(cfg),
            "mtu": cfg.get("mtu"),
            "dns_servers": cfg.get("nameservers", {}).get("addresses", []),
            "dns_search": cfg.get("nameservers", {}).get("search", []),
        }
    return {"name": name, "dhcp": True, "addresses": [], "gateway": None, "mtu": None, "dns_servers": [], "dns_search": []}


def _extract_gateway(cfg: dict) -> str | None:
    routes = cfg.get("routes", [])
    for r in routes:
        if r.get("to") == "default":
            return r.get("via")
    return None


@router.put("/interfaces/{name}")
def update_interface(name: str, body: InterfaceConfig):
    _validate_iface_name(name)
    _validate_addresses(body.addresses)
    _validate_ip(body.gateway, "gateway")
    _validate_mtu(body.mtu)
    _validate_dns(body.dns_servers)

    data = _read_netplan()
    net = data.setdefault("network", {"version": 2})
    net.setdefault("version", 2)
    ethernets = net.setdefault("ethernets", {})

    cfg = {}
    if body.dhcp:
        cfg["dhcp4"] = True
    else:
        cfg["dhcp4"] = False
        if body.addresses:
            cfg["addresses"] = body.addresses
        if body.gateway:
            cfg["routes"] = [{"to": "default", "via": body.gateway}]
        if body.dns_servers:
            cfg.setdefault("nameservers", {})["addresses"] = body.dns_servers
        if body.dns_search:
            cfg.setdefault("nameservers", {})["search"] = body.dns_search
    if body.mtu:
        cfg["mtu"] = body.mtu

    ethernets[name] = cfg
    _write_netplan(data)
    _apply_netplan()
    return {"message": f"Interface {name} updated"}


# --- Bonds ---

@router.get("/bonds")
def list_bonds():
    data = _read_netplan()
    bonds = data.get("network", {}).get("bonds", {})
    result = []
    ifaces = _build_iface_list()
    iface_map = {i["name"]: i for i in ifaces}

    for name, cfg in bonds.items():
        iface = iface_map.get(name, {})
        addrs = cfg.get("addresses", [])
        if cfg.get("dhcp4") and not addrs:
            live = iface_map.get(name, {})
            addrs = live.get("addresses", [])
        result.append({
            "name": name,
            "mode": cfg.get("parameters", {}).get("mode", ""),
            "interfaces": cfg.get("interfaces", []),
            "addresses": addrs,
            "state": iface.get("state", "unknown"),
            "dhcp": cfg.get("dhcp4", False),
            "gateway": _extract_gateway(cfg),
            "mtu": cfg.get("mtu"),
            "dns_servers": cfg.get("nameservers", {}).get("addresses", []),
            "lacp_rate": cfg.get("parameters", {}).get("lacp-rate"),
            "mii_monitor_interval": cfg.get("parameters", {}).get("mii-monitor-interval"),
        })
    return result


@router.post("/bonds")
def create_bond(body: BondCreate):
    _validate_iface_name(body.name)
    if body.mode not in VALID_BOND_MODES:
        raise HTTPException(status_code=400, detail=f"Invalid bond mode: {body.mode}. Valid: {', '.join(sorted(VALID_BOND_MODES))}")
    for iface in body.interfaces:
        _validate_iface_name(iface)
    if len(body.interfaces) < 2:
        raise HTTPException(status_code=400, detail="Bond requires at least 2 member interfaces")
    if not body.dhcp:
        _validate_addresses(body.addresses)
        _validate_ip(body.gateway, "gateway")
    _validate_mtu(body.mtu)
    _validate_dns(body.dns_servers)
    if body.lacp_rate and body.lacp_rate not in ("fast", "slow"):
        raise HTTPException(status_code=400, detail="lacp_rate must be 'fast' or 'slow'")

    data = _read_netplan()
    net = data.setdefault("network", {"version": 2})
    net.setdefault("version", 2)
    bonds = net.get("bonds", {})
    if body.name in bonds:
        raise HTTPException(status_code=409, detail=f"Bond {body.name} already exists")

    # Ensure member interfaces are listed in ethernets section
    ethernets = net.setdefault("ethernets", {})
    for iface in body.interfaces:
        if iface not in ethernets:
            ethernets[iface] = {}

    bond_cfg = {
        "interfaces": body.interfaces,
        "parameters": {
            "mode": body.mode,
            "mii-monitor-interval": body.mii_monitor_interval or 100,
        },
    }
    if body.mode == "802.3ad" and body.lacp_rate:
        bond_cfg["parameters"]["lacp-rate"] = body.lacp_rate

    if body.dhcp:
        bond_cfg["dhcp4"] = True
    else:
        bond_cfg["dhcp4"] = False
        if body.addresses:
            bond_cfg["addresses"] = body.addresses
        if body.gateway:
            bond_cfg["routes"] = [{"to": "default", "via": body.gateway}]
        if body.dns_servers:
            bond_cfg["nameservers"] = {"addresses": body.dns_servers}

    if body.mtu:
        bond_cfg["mtu"] = body.mtu

    net.setdefault("bonds", {})[body.name] = bond_cfg
    _write_netplan(data)
    _apply_netplan()
    return {"message": f"Bond {body.name} created"}


@router.put("/bonds/{name}")
def update_bond(name: str, body: BondUpdate):
    _validate_iface_name(name)
    data = _read_netplan()
    bonds = data.get("network", {}).get("bonds", {})
    if name not in bonds:
        raise HTTPException(status_code=404, detail=f"Bond {name} not found")

    if body.mode is not None and body.mode not in VALID_BOND_MODES:
        raise HTTPException(status_code=400, detail=f"Invalid bond mode: {body.mode}")
    if body.interfaces is not None:
        for iface in body.interfaces:
            _validate_iface_name(iface)
        if len(body.interfaces) < 2:
            raise HTTPException(status_code=400, detail="Bond requires at least 2 member interfaces")
    if body.dhcp is False or (body.dhcp is None and not bonds[name].get("dhcp4")):
        _validate_addresses(body.addresses)
        _validate_ip(body.gateway, "gateway")
    _validate_mtu(body.mtu)
    _validate_dns(body.dns_servers)
    if body.lacp_rate and body.lacp_rate not in ("fast", "slow"):
        raise HTTPException(status_code=400, detail="lacp_rate must be 'fast' or 'slow'")

    cfg = bonds[name]

    if body.interfaces is not None:
        cfg["interfaces"] = body.interfaces
        ethernets = data["network"].setdefault("ethernets", {})
        for iface in body.interfaces:
            if iface not in ethernets:
                ethernets[iface] = {}

    if body.mode is not None:
        cfg.setdefault("parameters", {})["mode"] = body.mode

    if body.mii_monitor_interval is not None:
        cfg.setdefault("parameters", {})["mii-monitor-interval"] = body.mii_monitor_interval

    if body.lacp_rate is not None:
        cfg.setdefault("parameters", {})["lacp-rate"] = body.lacp_rate

    if body.dhcp is not None:
        if body.dhcp:
            cfg["dhcp4"] = True
            cfg.pop("addresses", None)
            cfg.pop("routes", None)
            cfg.pop("nameservers", None)
        else:
            cfg["dhcp4"] = False
            if body.addresses is not None:
                cfg["addresses"] = body.addresses
            if body.gateway is not None:
                cfg["routes"] = [{"to": "default", "via": body.gateway}]
            if body.dns_servers is not None:
                cfg["nameservers"] = {"addresses": body.dns_servers}
    else:
        if body.addresses is not None:
            cfg["addresses"] = body.addresses
        if body.gateway is not None:
            cfg["routes"] = [{"to": "default", "via": body.gateway}]
        if body.dns_servers is not None:
            cfg.setdefault("nameservers", {})["addresses"] = body.dns_servers

    if body.mtu is not None:
        cfg["mtu"] = body.mtu

    _write_netplan(data)
    _apply_netplan()
    return {"message": f"Bond {name} updated"}


@router.delete("/bonds/{name}")
def delete_bond(name: str):
    _validate_iface_name(name)
    data = _read_netplan()
    bonds = data.get("network", {}).get("bonds", {})
    if name not in bonds:
        raise HTTPException(status_code=404, detail=f"Bond {name} not found")

    del bonds[name]
    if not bonds:
        data["network"].pop("bonds", None)

    _write_netplan(data)
    _apply_netplan()
    return {"message": f"Bond {name} deleted"}


# --- DNS ---

@router.get("/dns")
def get_dns():
    result = run([*NSENTER, "resolvectl", "status"])
    if not result.ok:
        return {"servers": [], "search": [], "raw": ""}

    servers = []
    search = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if line.startswith("DNS Servers:") or line.startswith("Current DNS Server:"):
            parts = line.split(":", 1)
            if len(parts) == 2:
                for s in parts[1].strip().split():
                    if s and s not in servers:
                        servers.append(s)
        elif line.startswith("DNS Domain:"):
            parts = line.split(":", 1)
            if len(parts) == 2:
                for d in parts[1].strip().split():
                    if d and d not in search:
                        search.append(d)

    return {"servers": servers, "search": search, "raw": result.stdout}


# --- Routes ---

@router.get("/routes")
def get_routes():
    result = run([*NSENTER, "ip", "-j", "route", "show"])
    if not result.ok:
        return []
    try:
        routes = json.loads(result.stdout)
    except json.JSONDecodeError:
        return []

    return [
        {
            "destination": r.get("dst", ""),
            "gateway": r.get("gateway", ""),
            "interface": r.get("dev", ""),
            "metric": r.get("metric", ""),
            "protocol": r.get("protocol", ""),
        }
        for r in routes
    ]
