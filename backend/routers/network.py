import json
import logging
import re
from pathlib import Path

import yaml
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from backend.database import get_db
from backend.utils.auth import get_current_admin
from backend.utils.shell import run

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/network", tags=["network"], dependencies=[Depends(get_current_admin)])

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


class GlobalConfig(BaseModel):
    hostname: str | None = None
    domain: str | None = None
    additional_domains: list[str] | None = None
    nameserver1: str | None = None
    nameserver2: str | None = None
    nameserver3: str | None = None
    ipv4_gateway: str | None = None
    ipv6_gateway: str | None = None
    service_announcement: dict | None = None
    http_proxy: str | None = None
    netwait_enabled: bool = False
    netwait_ip_list: list[str] | None = None
    host_name_database: str | None = None


class StaticRouteCreate(BaseModel):
    destination: str
    gateway: str
    description: str = ""


class StaticRouteDelete(BaseModel):
    destination: str
    gateway: str


class IPMIConfig(BaseModel):
    dhcp: bool = True
    ipv4_address: str | None = None
    ipv4_netmask: str | None = None
    ipv4_gateway: str | None = None
    vlan_id: int | None = None
    password: str | None = None


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
            val = line.split(":", 1)[1].strip()
            if val and "Unknown" not in val:
                info["speed"] = val
        elif line.startswith("Duplex:"):
            val = line.split(":", 1)[1].strip()
            if val and "Unknown" not in val:
                info["duplex"] = val
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
        state = iface.get("operstate", "UNKNOWN").lower()
        # ZeroTier and similar tunnel interfaces report operstate UNKNOWN
        # even when functional — treat as up if they have addresses
        if state == "unknown" and addrs:
            state = "up"
        mac = iface.get("address", "")
        mtu = iface.get("mtu")
        ethtool = _get_ethtool_info(name) if iface_type == "physical" else {"speed": None, "duplex": None}

        interfaces.append({
            "name": name,
            "type": iface_type,
            "state": state,
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


# --- VLANs ---

class VlanCreate(BaseModel):
    name: str | None = None
    id: int
    link: str
    dhcp: bool = True
    addresses: list[str] | None = None
    gateway: str | None = None
    mtu: int | None = None
    dns_servers: list[str] | None = None


@router.get("/vlans")
def list_vlans():
    data = _read_netplan()
    vlans = data.get("network", {}).get("vlans", {})
    ifaces = _build_iface_list()
    iface_map = {i["name"]: i for i in ifaces}
    result = []
    for name, cfg in vlans.items():
        iface = iface_map.get(name, {})
        addrs = cfg.get("addresses", [])
        if cfg.get("dhcp4") and not addrs:
            addrs = iface.get("addresses", [])
        result.append({
            "name": name,
            "id": cfg.get("id"),
            "link": cfg.get("link", ""),
            "addresses": addrs,
            "state": iface.get("state", "unknown"),
            "dhcp": cfg.get("dhcp4", False),
            "gateway": _extract_gateway(cfg),
            "mtu": cfg.get("mtu"),
            "dns_servers": cfg.get("nameservers", {}).get("addresses", []),
        })
    return result


@router.post("/vlans")
def create_vlan(body: VlanCreate, username: str = Depends(get_current_admin)):
    if body.id < 1 or body.id > 4094:
        raise HTTPException(status_code=400, detail="VLAN ID must be between 1 and 4094")
    _validate_iface_name(body.link)
    if not body.dhcp:
        _validate_addresses(body.addresses)
        _validate_ip(body.gateway, "gateway")
    _validate_mtu(body.mtu)
    _validate_dns(body.dns_servers)

    vlan_name = body.name or f"vlan{body.id}"
    if not IFACE_RE.match(vlan_name):
        raise HTTPException(status_code=400, detail=f"Invalid VLAN name: {vlan_name}")

    data = _read_netplan()
    net = data.setdefault("network", {"version": 2})
    net.setdefault("version", 2)
    vlans = net.get("vlans", {})
    if vlan_name in vlans:
        raise HTTPException(status_code=409, detail=f"VLAN {vlan_name} already exists")

    vlan_cfg = {
        "id": body.id,
        "link": body.link,
    }

    if body.dhcp:
        vlan_cfg["dhcp4"] = True
    else:
        vlan_cfg["dhcp4"] = False
        if body.addresses:
            vlan_cfg["addresses"] = body.addresses
        if body.gateway:
            vlan_cfg["routes"] = [{"to": "default", "via": body.gateway}]
        if body.dns_servers:
            vlan_cfg["nameservers"] = {"addresses": body.dns_servers}

    if body.mtu:
        vlan_cfg["mtu"] = body.mtu

    net.setdefault("vlans", {})[vlan_name] = vlan_cfg
    _write_netplan(data)
    _apply_netplan()

    logger.info(f"User '{username}' created VLAN {vlan_name} (id={body.id}, link={body.link})")
    return {"message": f"VLAN {vlan_name} created"}


@router.delete("/vlans/{name}")
def delete_vlan(name: str, username: str = Depends(get_current_admin)):
    _validate_iface_name(name)
    data = _read_netplan()
    vlans = data.get("network", {}).get("vlans", {})
    if name not in vlans:
        raise HTTPException(status_code=404, detail=f"VLAN {name} not found")

    del vlans[name]
    if not vlans:
        data["network"].pop("vlans", None)

    _write_netplan(data)
    _apply_netplan()

    logger.info(f"User '{username}' deleted VLAN {name}")
    return {"message": f"VLAN {name} deleted"}


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


# --- Global Configuration ---

def _get_network_config_value(key: str, default: str = "") -> str:
    db = get_db()
    try:
        row = db.execute("SELECT value FROM network_config WHERE key = ?", (key,)).fetchone()
        return row[0] if row else default
    finally:
        db.close()


def _set_network_config_value(key: str, value: str):
    db = get_db()
    try:
        db.execute(
            "INSERT OR REPLACE INTO network_config (key, value) VALUES (?, ?)",
            (key, value),
        )
        db.commit()
    finally:
        db.close()


@router.get("/global-config")
def get_global_config():
    # Hostname
    hostname_result = run([*NSENTER, "hostname", "-s"])
    hostname = hostname_result.stdout.strip() if hostname_result.ok else ""

    # Domain
    domain_result = run([*NSENTER, "hostname", "-d"])
    domain = domain_result.stdout.strip() if domain_result.ok else ""

    # DNS servers from netplan or resolvectl
    data = _read_netplan()
    net = data.get("network", {})

    # Collect global nameservers from netplan ethernets
    ns1 = ""
    ns2 = ""
    ns3 = ""
    search_domains = []
    for section_key in ("ethernets", "bonds"):
        section = net.get(section_key, {})
        for iface_cfg in section.values():
            ns_cfg = iface_cfg.get("nameservers", {})
            addrs = ns_cfg.get("addresses", [])
            for i, addr in enumerate(addrs):
                if i == 0 and not ns1:
                    ns1 = addr
                elif i == 1 and not ns2:
                    ns2 = addr
                elif i == 2 and not ns3:
                    ns3 = addr
            for d in ns_cfg.get("search", []):
                if d not in search_domains:
                    search_domains.append(d)

    # Gateways from netplan routes
    ipv4_gw = ""
    ipv6_gw = ""
    for section_key in ("ethernets", "bonds"):
        section = net.get(section_key, {})
        for iface_cfg in section.values():
            for route in iface_cfg.get("routes", []):
                if route.get("to") == "default":
                    via = route.get("via", "")
                    if ":" in via:
                        if not ipv6_gw:
                            ipv6_gw = via
                    else:
                        if not ipv4_gw:
                            ipv4_gw = via

    # DB-backed settings
    netbios = _get_network_config_value("netbios_ns", "false") == "true"
    mdns = _get_network_config_value("mdns", "false") == "true"
    ws_discovery = _get_network_config_value("ws_discovery", "false") == "true"
    http_proxy = _get_network_config_value("http_proxy", "")
    netwait_enabled = _get_network_config_value("netwait_enabled", "false") == "true"
    netwait_ip_list_raw = _get_network_config_value("netwait_ip_list", "")
    netwait_ip_list = [ip.strip() for ip in netwait_ip_list_raw.split(",") if ip.strip()] if netwait_ip_list_raw else []
    host_name_database = _get_network_config_value("host_name_database", "")

    return {
        "hostname": hostname,
        "domain": domain,
        "additional_domains": search_domains,
        "nameserver1": ns1,
        "nameserver2": ns2,
        "nameserver3": ns3,
        "ipv4_gateway": ipv4_gw,
        "ipv6_gateway": ipv6_gw,
        "service_announcement": {
            "netbios_ns": netbios,
            "mdns": mdns,
            "ws_discovery": ws_discovery,
        },
        "http_proxy": http_proxy,
        "netwait_enabled": netwait_enabled,
        "netwait_ip_list": netwait_ip_list,
        "host_name_database": host_name_database,
    }


@router.put("/global-config")
def update_global_config(body: GlobalConfig):
    # Hostname
    if body.hostname:
        result = run([*NSENTER, "hostnamectl", "set-hostname", body.hostname])
        if not result.ok:
            raise HTTPException(status_code=500, detail=f"Failed to set hostname: {result.stderr.strip()}")

    # Update netplan for DNS servers, gateways, search domains
    data = _read_netplan()
    net = data.setdefault("network", {"version": 2})
    net.setdefault("version", 2)

    # Find the first configured ethernet or bond to attach global DNS/gateway settings
    target_section = None
    target_iface = None
    for section_key in ("ethernets", "bonds"):
        section = net.get(section_key, {})
        for iface_name, iface_cfg in section.items():
            if iface_cfg.get("dhcp4") is False or iface_cfg.get("addresses"):
                target_section = section_key
                target_iface = iface_name
                break
            if target_iface is None:
                target_section = section_key
                target_iface = iface_name
        if target_iface:
            break

    if target_iface:
        cfg = net.setdefault(target_section, {}).setdefault(target_iface, {})

        # DNS servers
        nameservers = []
        for ns in [body.nameserver1, body.nameserver2, body.nameserver3]:
            if ns and ns.strip():
                nameservers.append(ns.strip())
        if nameservers:
            cfg.setdefault("nameservers", {})["addresses"] = nameservers

        # Search domains
        if body.domain or body.additional_domains:
            domains = []
            if body.domain:
                domains.append(body.domain)
            if body.additional_domains:
                domains.extend(body.additional_domains)
            cfg.setdefault("nameservers", {})["search"] = domains

        # Gateway
        if body.ipv4_gateway:
            _validate_ip(body.ipv4_gateway, "IPv4 gateway")
            routes = cfg.get("routes", [])
            routes = [r for r in routes if r.get("to") != "default" or ":" in r.get("via", "")]
            routes.append({"to": "default", "via": body.ipv4_gateway})
            cfg["routes"] = routes

        if body.ipv6_gateway:
            routes = cfg.get("routes", [])
            routes = [r for r in routes if r.get("to") != "default" or ":" not in r.get("via", "")]
            routes.append({"to": "default", "via": body.ipv6_gateway})
            cfg["routes"] = routes

    _write_netplan(data)
    _apply_netplan()

    # DB-backed settings
    if body.service_announcement:
        sa = body.service_announcement
        if "netbios_ns" in sa:
            _set_network_config_value("netbios_ns", "true" if sa["netbios_ns"] else "false")
        if "mdns" in sa:
            _set_network_config_value("mdns", "true" if sa["mdns"] else "false")
        if "ws_discovery" in sa:
            _set_network_config_value("ws_discovery", "true" if sa["ws_discovery"] else "false")

    if body.http_proxy is not None:
        _set_network_config_value("http_proxy", body.http_proxy)
    _set_network_config_value("netwait_enabled", "true" if body.netwait_enabled else "false")
    if body.netwait_ip_list is not None:
        _set_network_config_value("netwait_ip_list", ",".join(body.netwait_ip_list))
    if body.host_name_database is not None:
        _set_network_config_value("host_name_database", body.host_name_database)

    return {"message": "Global configuration updated"}


# --- Static Routes CRUD ---

@router.get("/static-routes")
def list_static_routes():
    data = _read_netplan()
    net = data.get("network", {})

    # Collect static routes from netplan (non-default routes)
    routes = []
    seen = set()
    for section_key in ("ethernets", "bonds"):
        section = net.get(section_key, {})
        for iface_cfg in section.values():
            for route in iface_cfg.get("routes", []):
                dest = route.get("to", "")
                gw = route.get("via", "")
                if dest and dest != "default" and (dest, gw) not in seen:
                    seen.add((dest, gw))
                    routes.append({"destination": dest, "gateway": gw})

    # Add descriptions from DB
    db = get_db()
    try:
        desc_rows = db.execute("SELECT destination, gateway, description FROM static_route_descriptions").fetchall()
        desc_map = {(r[0], r[1]): r[2] for r in desc_rows}
    finally:
        db.close()

    for r in routes:
        r["description"] = desc_map.get((r["destination"], r["gateway"]), "")

    return routes


@router.post("/static-routes")
def create_static_route(body: StaticRouteCreate):
    # Validate destination is CIDR
    if not re.match(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/\d{1,2}$", body.destination):
        raise HTTPException(status_code=400, detail=f"Invalid CIDR destination: {body.destination}")
    _validate_ip(body.gateway, "gateway")

    data = _read_netplan()
    net = data.setdefault("network", {"version": 2})
    net.setdefault("version", 2)

    # Find first interface section to attach the route
    target_section = None
    target_iface = None
    for section_key in ("ethernets", "bonds"):
        section = net.get(section_key, {})
        for iface_name in section:
            target_section = section_key
            target_iface = iface_name
            break
        if target_iface:
            break

    if not target_iface:
        raise HTTPException(status_code=400, detail="No network interfaces configured in netplan")

    cfg = net[target_section][target_iface]
    routes = cfg.get("routes", [])

    # Check for duplicates
    for r in routes:
        if r.get("to") == body.destination and r.get("via") == body.gateway:
            raise HTTPException(status_code=409, detail="Route already exists")

    routes.append({"to": body.destination, "via": body.gateway})
    cfg["routes"] = routes

    _write_netplan(data)
    _apply_netplan()

    # Store description in DB
    if body.description:
        db = get_db()
        try:
            db.execute(
                "INSERT OR REPLACE INTO static_route_descriptions (destination, gateway, description) VALUES (?, ?, ?)",
                (body.destination, body.gateway, body.description),
            )
            db.commit()
        finally:
            db.close()

    return {"message": "Static route created"}


@router.delete("/static-routes")
def delete_static_route(body: StaticRouteDelete):
    data = _read_netplan()
    net = data.get("network", {})

    found = False
    for section_key in ("ethernets", "bonds"):
        section = net.get(section_key, {})
        for iface_name, iface_cfg in section.items():
            routes = iface_cfg.get("routes", [])
            new_routes = [r for r in routes if not (r.get("to") == body.destination and r.get("via") == body.gateway)]
            if len(new_routes) < len(routes):
                found = True
                if new_routes:
                    iface_cfg["routes"] = new_routes
                else:
                    iface_cfg.pop("routes", None)

    if not found:
        raise HTTPException(status_code=404, detail="Route not found")

    _write_netplan(data)
    _apply_netplan()

    # Remove description from DB
    db = get_db()
    try:
        db.execute(
            "DELETE FROM static_route_descriptions WHERE destination = ? AND gateway = ?",
            (body.destination, body.gateway),
        )
        db.commit()
    finally:
        db.close()

    return {"message": "Static route deleted"}


# --- IPMI ---

@router.get("/ipmi")
def get_ipmi():
    # Check if ipmitool is available
    check = run([*NSENTER, "which", "ipmitool"], timeout=5)
    if not check.ok:
        return {"available": False}

    # Check if BMC is reachable
    mc_info = run([*NSENTER, "ipmitool", "mc", "info"], timeout=10)
    if not mc_info.ok:
        return {"available": False}

    # Read LAN config
    lan_result = run([*NSENTER, "ipmitool", "lan", "print", "1"], timeout=10)
    if not lan_result.ok:
        return {"available": True, "dhcp": True, "ipv4_address": "", "ipv4_netmask": "", "ipv4_gateway": "", "vlan_id": None}

    config = {
        "available": True,
        "dhcp": True,
        "ipv4_address": "",
        "ipv4_netmask": "",
        "ipv4_gateway": "",
        "vlan_id": None,
    }

    for line in lan_result.stdout.splitlines():
        line = line.strip()
        if line.startswith("IP Address Source"):
            config["dhcp"] = "DHCP" in line.split(":", 1)[1].strip()
        elif line.startswith("IP Address") and "Source" not in line:
            config["ipv4_address"] = line.split(":", 1)[1].strip()
        elif line.startswith("Subnet Mask"):
            config["ipv4_netmask"] = line.split(":", 1)[1].strip()
        elif line.startswith("Default Gateway IP"):
            config["ipv4_gateway"] = line.split(":", 1)[1].strip()
        elif line.startswith("802.1q VLAN ID"):
            val = line.split(":", 1)[1].strip()
            if val and val != "Disabled":
                try:
                    config["vlan_id"] = int(val)
                except ValueError:
                    pass

    return config


@router.put("/ipmi")
def update_ipmi(body: IPMIConfig):
    check = run([*NSENTER, "which", "ipmitool"], timeout=5)
    if not check.ok:
        raise HTTPException(status_code=400, detail="ipmitool not available")

    if body.dhcp:
        result = run([*NSENTER, "ipmitool", "lan", "set", "1", "ipsrc", "dhcp"], timeout=10)
        if not result.ok:
            raise HTTPException(status_code=500, detail=f"Failed to set DHCP: {result.stderr.strip()}")
    else:
        result = run([*NSENTER, "ipmitool", "lan", "set", "1", "ipsrc", "static"], timeout=10)
        if not result.ok:
            raise HTTPException(status_code=500, detail=f"Failed to set static IP source: {result.stderr.strip()}")
        if body.ipv4_address:
            r = run([*NSENTER, "ipmitool", "lan", "set", "1", "ipaddr", body.ipv4_address], timeout=10)
            if not r.ok:
                raise HTTPException(status_code=500, detail=f"Failed to set IP: {r.stderr.strip()}")
        if body.ipv4_netmask:
            r = run([*NSENTER, "ipmitool", "lan", "set", "1", "netmask", body.ipv4_netmask], timeout=10)
            if not r.ok:
                raise HTTPException(status_code=500, detail=f"Failed to set netmask: {r.stderr.strip()}")
        if body.ipv4_gateway:
            r = run([*NSENTER, "ipmitool", "lan", "set", "1", "defgw", "ipaddr", body.ipv4_gateway], timeout=10)
            if not r.ok:
                raise HTTPException(status_code=500, detail=f"Failed to set gateway: {r.stderr.strip()}")

    if body.vlan_id is not None:
        r = run([*NSENTER, "ipmitool", "lan", "set", "1", "vlan", "id", str(body.vlan_id)], timeout=10)
        if not r.ok:
            raise HTTPException(status_code=500, detail=f"Failed to set VLAN: {r.stderr.strip()}")

    if body.password:
        r = run([*NSENTER, "ipmitool", "user", "set", "password", "2", body.password], timeout=10)
        if not r.ok:
            raise HTTPException(status_code=500, detail=f"Failed to set password: {r.stderr.strip()}")

    return {"message": "IPMI configuration updated"}


@router.post("/ipmi/identify")
def ipmi_identify():
    check = run([*NSENTER, "which", "ipmitool"], timeout=5)
    if not check.ok:
        raise HTTPException(status_code=400, detail="ipmitool not available")

    result = run([*NSENTER, "ipmitool", "chassis", "identify", "15"], timeout=10)
    if not result.ok:
        raise HTTPException(status_code=500, detail=f"Identify failed: {result.stderr.strip()}")

    return {"message": "Identify light activated for 15 seconds"}
