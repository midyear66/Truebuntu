import json
import logging
import time

from fastapi import APIRouter, Depends

from backend.database import get_db
from backend.utils.auth import get_current_user
from backend.utils.shell import run
from backend.utils.zfs import parse_zpool_list, parse_zpool_status, parse_zfs_list, list_snapshots

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/dashboard", tags=["dashboard"], dependencies=[Depends(get_current_user)])

# Track which alerts have been sent to avoid spamming on every dashboard poll.
# Resets when the condition clears (pool goes back to ONLINE, capacity drops).
_alerted_pools: dict[str, set[str]] = {}  # pool_name -> set of alert types sent
CAPACITY_THRESHOLD = 80

NSENTER = ["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--"]


@router.get("")
def dashboard():
    return {
        "system": _get_system_info(),
        "cpu": _get_cpu_info(),
        "pools": _get_pool_details(),
        "datasets": parse_zfs_list(),
        "recent_snapshots": list_snapshots()[-10:],
        "services": _get_service_states(),
        "disk_temps": _get_disk_temps(),
        "upcoming_tasks": _get_upcoming_tasks(),
        "load_average": _get_load_average(),
        "memory": _get_memory(),
        "network": _get_network_stats(),
        "interfaces": _get_interfaces(),
    }


# --- System Info ---

def _get_system_info() -> dict:
    hostname = run(["hostname"])
    uptime = run(["uptime", "-p"])

    version = "unknown"
    os_release = run([*NSENTER, "cat", "/etc/os-release"])
    if os_release.ok:
        for line in os_release.stdout.splitlines():
            if line.startswith("PRETTY_NAME="):
                version = line.split("=", 1)[1].strip().strip('"')
                break

    kernel = "unknown"
    uname = run([*NSENTER, "uname", "-r"])
    if uname.ok:
        kernel = uname.stdout.strip()

    return {
        "hostname": hostname.stdout.strip() if hostname.ok else "unknown",
        "uptime": uptime.stdout.strip() if uptime.ok else "unknown",
        "version": version,
        "kernel": kernel,
    }


# --- CPU ---

def _get_cpu_info() -> dict:
    model = "unknown"
    threads = 0

    cpuinfo = run([*NSENTER, "cat", "/proc/cpuinfo"])
    if cpuinfo.ok:
        for line in cpuinfo.stdout.splitlines():
            if line.startswith("model name") and model == "unknown":
                model = line.split(":", 1)[1].strip()
            if line.startswith("processor"):
                threads += 1

    # Physical core count
    cores = threads
    core_ids = set()
    if cpuinfo.ok:
        for line in cpuinfo.stdout.splitlines():
            if line.startswith("core id"):
                core_ids.add(line.split(":", 1)[1].strip())
        if core_ids:
            cores = len(core_ids)

    # Per-CPU usage via two /proc/stat readings
    usage_per_thread = []
    avg_usage = 0.0
    stat1 = run([*NSENTER, "cat", "/proc/stat"])
    if stat1.ok:
        time.sleep(0.2)
        stat2 = run([*NSENTER, "cat", "/proc/stat"])
        if stat2.ok:
            usage_per_thread = _calc_cpu_usage(stat1.stdout, stat2.stdout)
            if usage_per_thread:
                avg_usage = round(sum(usage_per_thread) / len(usage_per_thread), 1)

    # CPU temperatures from thermal zones
    temperatures = []
    for i in range(20):
        temp_result = run([*NSENTER, "cat", f"/sys/class/thermal/thermal_zone{i}/temp"])
        if not temp_result.ok:
            break
        try:
            temp_c = int(temp_result.stdout.strip()) / 1000.0
            temperatures.append(round(temp_c, 1))
        except (ValueError, IndexError):
            break

    return {
        "model": model,
        "cores": cores,
        "threads": threads,
        "usage_per_thread": usage_per_thread,
        "avg_usage": avg_usage,
        "temperatures": temperatures,
    }


def _calc_cpu_usage(stat1: str, stat2: str) -> list[float]:
    """Calculate per-CPU usage % from two /proc/stat snapshots."""
    def parse_cpu_lines(text):
        cpus = {}
        for line in text.splitlines():
            if line.startswith("cpu") and not line.startswith("cpu "):
                parts = line.split()
                name = parts[0]
                values = [int(v) for v in parts[1:]]
                cpus[name] = values
        return cpus

    cpus1 = parse_cpu_lines(stat1)
    cpus2 = parse_cpu_lines(stat2)

    usage = []
    for name in sorted(cpus1.keys()):
        if name not in cpus2:
            continue
        v1 = cpus1[name]
        v2 = cpus2[name]
        # Fields: user, nice, system, idle, iowait, irq, softirq, steal
        total1 = sum(v1[:8]) if len(v1) >= 8 else sum(v1)
        total2 = sum(v2[:8]) if len(v2) >= 8 else sum(v2)
        idle1 = v1[3] + (v1[4] if len(v1) > 4 else 0)
        idle2 = v2[3] + (v2[4] if len(v2) > 4 else 0)
        total_delta = total2 - total1
        idle_delta = idle2 - idle1
        if total_delta > 0:
            pct = round((1 - idle_delta / total_delta) * 100, 1)
            usage.append(max(0.0, pct))
        else:
            usage.append(0.0)
    return usage


# --- Memory (enhanced with ARC) ---

def _get_memory() -> dict:
    result = run([*NSENTER, "cat", "/proc/meminfo"])
    if not result.ok:
        return {}
    info = {}
    for line in result.stdout.strip().splitlines():
        parts = line.split(":")
        if len(parts) == 2:
            key = parts[0].strip()
            val = parts[1].strip().split()[0]
            try:
                info[key] = int(val)
            except ValueError:
                pass
    total = info.get("MemTotal", 0)
    available = info.get("MemAvailable", 0)
    buffers = info.get("Buffers", 0)
    cached = info.get("Cached", 0)
    used = total - available
    percent = round((used / total) * 100, 1) if total else 0

    # ZFS ARC size
    arc_size_kb = 0
    arcstats = run([*NSENTER, "cat", "/proc/spl/kstat/zfs/arcstats"])
    if arcstats.ok:
        for line in arcstats.stdout.splitlines():
            parts = line.split()
            if len(parts) >= 3 and parts[0] == "size":
                try:
                    arc_size_kb = int(parts[2]) // 1024
                except (ValueError, IndexError):
                    pass
                break

    services_kb = max(0, used - arc_size_kb)

    return {
        "total_kb": total,
        "available_kb": available,
        "used_kb": used,
        "buffers_kb": buffers,
        "cached_kb": cached,
        "percent": percent,
        "arc_size_kb": arc_size_kb,
        "services_kb": services_kb,
    }


# --- Pool Details ---

def _get_pool_details() -> list[dict]:
    pools = parse_zpool_list()
    datasets = parse_zfs_list()

    # Build mountpoint map: pool root dataset -> mountpoint
    ds_map = {}
    for ds in datasets:
        ds_map[ds["name"]] = ds.get("mountpoint", "")

    for pool in pools:
        name = pool["name"]
        pool["path"] = ds_map.get(name, "")

        status = parse_zpool_status(name)
        vdevs = status.get("vdevs", [])

        # Walk vdev tree to count disks, vdevs, etc.
        data_vdevs = 0
        total_disks = 0
        disks_with_errors = 0
        cache_count = 0
        spare_count = 0
        log_count = 0

        current_section = "data"
        for node in vdevs:
            ntype = node.get("type", "")
            nname = node.get("name", "")

            if ntype == "section":
                if nname == "cache":
                    current_section = "cache"
                elif nname == "spares":
                    current_section = "spare"
                elif nname == "logs":
                    current_section = "log"
                continue

            if current_section == "data":
                if ntype == "vdev":
                    data_vdevs += 1
                    # Count child disks
                    for child in node.get("children", []):
                        if child.get("type") == "disk":
                            total_disks += 1
                            if _has_errors(child):
                                disks_with_errors += 1
                elif ntype == "disk":
                    # Single-disk vdev (stripe)
                    data_vdevs += 1
                    total_disks += 1
                    if _has_errors(node):
                        disks_with_errors += 1
            elif current_section == "cache":
                if ntype == "disk":
                    cache_count += 1
                else:
                    cache_count += len([c for c in node.get("children", []) if c.get("type") == "disk"])
            elif current_section == "spare":
                if ntype == "disk":
                    spare_count += 1
                else:
                    spare_count += len([c for c in node.get("children", []) if c.get("type") == "disk"])
            elif current_section == "log":
                if ntype == "disk":
                    log_count += 1
                else:
                    log_count += len([c for c in node.get("children", []) if c.get("type") == "disk"])

        pool["total_disks"] = total_disks
        pool["disks_with_errors"] = disks_with_errors
        pool["data_vdevs"] = data_vdevs
        pool["cache_count"] = cache_count
        pool["spare_count"] = spare_count
        pool["log_count"] = log_count
        pool["scan"] = status.get("scan", "")
        pool["scan_progress"] = status.get("scan_progress")

    _check_pool_alerts(pools)
    return pools


def _check_pool_alerts(pools: list[dict]):
    """Send alerts for degraded pools and high capacity, with dedup."""
    from backend.utils.email import send_alert

    for pool in pools:
        name = pool.get("name", "")
        if not name:
            continue

        alerted = _alerted_pools.setdefault(name, set())
        health = pool.get("health", "").upper()

        # Pool health alerts (DEGRADED, FAULTED, UNAVAIL)
        if health in ("DEGRADED", "FAULTED", "UNAVAIL"):
            if "degraded" not in alerted:
                send_alert(
                    "zfs_alerts",
                    f"Pool '{name}' is {health}",
                    f"ZFS pool '{name}' has entered {health} state. "
                    f"Check disk health and pool status immediately.\n\n"
                    f"Disks with errors: {pool.get('disks_with_errors', 0)}",
                )
                alerted.add("degraded")
        else:
            alerted.discard("degraded")

        # Capacity alerts (>= 80%)
        try:
            cap = int(pool.get("capacity", "0").rstrip("%"))
        except (ValueError, AttributeError):
            cap = 0

        if cap >= CAPACITY_THRESHOLD:
            if "capacity" not in alerted:
                send_alert(
                    "zfs_alerts",
                    f"Pool '{name}' is {cap}% full",
                    f"ZFS pool '{name}' has reached {cap}% capacity. "
                    f"ZFS performance degrades significantly above 80%. "
                    f"Consider expanding the pool or removing data.\n\n"
                    f"Size: {pool.get('size', 'N/A')}, "
                    f"Used: {pool.get('allocated', 'N/A')}, "
                    f"Free: {pool.get('free', 'N/A')}",
                )
                alerted.add("capacity")
        else:
            alerted.discard("capacity")


def _has_errors(node: dict) -> bool:
    try:
        return int(node.get("read", 0)) + int(node.get("write", 0)) + int(node.get("cksum", 0)) > 0
    except (ValueError, TypeError):
        return False


def _normalize_speed(raw: str) -> str:
    """Convert ethtool speed like '10000Mb/s' to '10 Gb/s'."""
    import re
    m = re.match(r"^(\d+)Mb/s$", raw)
    if m:
        mbps = int(m.group(1))
        if mbps >= 1000:
            return f"{mbps // 1000} Gb/s"
        return f"{mbps} Mb/s"
    return raw


# --- Interfaces ---

def _get_interfaces() -> list[dict]:
    """Build rich interface list with link state, addresses, speed, and traffic bytes."""
    # Get ip addr/link data via nsenter
    addr_result = run([*NSENTER, "ip", "-j", "addr", "show"])
    link_result = run([*NSENTER, "ip", "-j", "link", "show"])

    addr_data = []
    link_data = []
    if addr_result.ok:
        try:
            addr_data = json.loads(addr_result.stdout)
        except json.JSONDecodeError:
            pass
    if link_result.ok:
        try:
            link_data = json.loads(link_result.stdout)
        except json.JSONDecodeError:
            pass

    # Detect physical interfaces
    physical_set = set()
    proc_net = run([*NSENTER, "cat", "/proc/net/dev"])
    if proc_net.ok:
        for line in proc_net.stdout.splitlines()[2:]:
            iface_name = line.split(":")[0].strip()
            if iface_name:
                check = run([*NSENTER, "cat", f"/sys/class/net/{iface_name}/device/uevent"], timeout=5)
                if check.ok:
                    physical_set.add(iface_name)

    link_map = {link.get("ifname", ""): link for link in link_data}

    # Parse /proc/net/dev for rx/tx bytes
    traffic_map = {}
    if proc_net.ok:
        for line in proc_net.stdout.strip().splitlines()[2:]:
            parts = line.split(":")
            if len(parts) != 2:
                continue
            iface = parts[0].strip()
            fields = parts[1].split()
            if len(fields) >= 10:
                traffic_map[iface] = {
                    "rx_bytes": int(fields[0]),
                    "tx_bytes": int(fields[8]),
                }

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

        # Classify interface type
        linkinfo = link.get("linkinfo", {})
        info_kind = linkinfo.get("info_kind", "")
        if info_kind == "bond":
            iface_type = "bond"
        elif info_kind in ("bridge", "vlan", "veth", "tun", "tap", "dummy"):
            iface_type = "virtual"
        elif name in physical_set:
            iface_type = "physical"
        elif name.startswith(("veth", "docker", "br-")):
            iface_type = "virtual"
        else:
            iface_type = "physical" if link.get("link_type") == "ether" else "virtual"

        state = iface.get("operstate", "UNKNOWN").lower()
        # ZeroTier and similar tunnel interfaces report operstate UNKNOWN
        # even when functional — treat as up if they have addresses
        if state == "unknown" and addrs:
            state = "up"
        mac = iface.get("address", "")
        mtu = iface.get("mtu")

        ethtool = {"speed": None, "duplex": None}
        if iface_type == "physical":
            eth_result = run([*NSENTER, "ethtool", name])
            if eth_result.ok:
                for line in eth_result.stdout.splitlines():
                    line = line.strip()
                    if line.startswith("Speed:"):
                        val = line.split(":", 1)[1].strip()
                        if "Unknown" not in val:
                            ethtool["speed"] = _normalize_speed(val)
                    elif line.startswith("Duplex:"):
                        val = line.split(":", 1)[1].strip()
                        if "Unknown" not in val:
                            ethtool["duplex"] = val
            # Fallback: read speed from sysfs (returns Mb/s integer, -1 if unknown)
            if not ethtool["speed"]:
                spd = run([*NSENTER, "cat", f"/sys/class/net/{name}/speed"], timeout=5)
                if spd.ok:
                    try:
                        mbps = int(spd.stdout.strip())
                        if mbps > 0:
                            if mbps >= 1000:
                                ethtool["speed"] = f"{mbps // 1000} Gb/s"
                            else:
                                ethtool["speed"] = f"{mbps} Mb/s"
                    except ValueError:
                        pass
            # Last resort: show driver name for virtual NICs (virtio, vmxnet3, etc.)
            if not ethtool["speed"]:
                drv = run([*NSENTER, "cat", f"/sys/class/net/{name}/device/uevent"], timeout=5)
                if drv.ok:
                    for line in drv.stdout.splitlines():
                        if line.startswith("DRIVER="):
                            ethtool["speed"] = line.split("=", 1)[1].strip()
                            break

        traffic = traffic_map.get(name, {"rx_bytes": 0, "tx_bytes": 0})

        interfaces.append({
            "name": name,
            "type": iface_type,
            "state": state,
            "addresses": addrs,
            "mac": mac,
            "mtu": mtu,
            "speed": ethtool["speed"],
            "duplex": ethtool["duplex"],
            "rx_bytes": traffic["rx_bytes"],
            "tx_bytes": traffic["tx_bytes"],
        })

    return interfaces


# --- Existing helpers (unchanged) ---

def _get_service_states() -> list[dict]:
    services = ["smbd", "nmbd", "nfs-kernel-server", "ssh", "docker"]
    states = []
    for name in services:
        result = run([*NSENTER, "systemctl", "is-active", name])
        states.append({
            "name": name,
            "active": result.stdout.strip() or "unknown",
        })
    return states


def _get_disk_temps() -> list[dict]:
    result = run(["lsblk", "-d", "-n", "-o", "NAME,TYPE", "-e", "7,11"])
    if not result.ok:
        return []
    temps = []
    for line in result.stdout.strip().splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[1] == "disk":
            disk = parts[0]
            smart = run(["smartctl", "-A", "-j", f"/dev/{disk}"])
            temp = None
            if smart.stdout:
                try:
                    data = json.loads(smart.stdout)
                    temp = data.get("temperature", {}).get("current")
                except (json.JSONDecodeError, AttributeError):
                    pass
            temps.append({"disk": disk, "temperature": temp})
    return temps


def _get_upcoming_tasks() -> list[dict]:
    db = get_db()
    try:
        rows = db.execute(
            "SELECT id, name, type, schedule FROM tasks WHERE enabled = 1 ORDER BY id LIMIT 10"
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        db.close()


def _get_load_average() -> dict:
    result = run([*NSENTER, "cat", "/proc/loadavg"])
    if not result.ok:
        return {"load1": 0, "load5": 0, "load15": 0}
    parts = result.stdout.strip().split()
    return {
        "load1": float(parts[0]) if len(parts) > 0 else 0,
        "load5": float(parts[1]) if len(parts) > 1 else 0,
        "load15": float(parts[2]) if len(parts) > 2 else 0,
    }


def _get_network_stats() -> list[dict]:
    result = run([*NSENTER, "cat", "/proc/net/dev"])
    if not result.ok:
        return []
    stats = []
    for line in result.stdout.strip().splitlines()[2:]:
        parts = line.split(":")
        if len(parts) != 2:
            continue
        iface = parts[0].strip()
        if iface == "lo":
            continue
        fields = parts[1].split()
        if len(fields) < 10:
            continue
        stats.append({
            "interface": iface,
            "rx_bytes": int(fields[0]),
            "tx_bytes": int(fields[8]),
        })
    return stats
