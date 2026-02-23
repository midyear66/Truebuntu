import json
import re
from backend.utils.shell import run


def parse_zpool_list() -> list[dict]:
    result = run(["zpool", "list", "-H", "-o", "name,size,alloc,free,frag,cap,health"])
    if not result.ok:
        return []
    pools = []
    for line in result.stdout.strip().splitlines():
        fields = line.split("\t")
        if len(fields) >= 7:
            pools.append({
                "name": fields[0],
                "size": fields[1],
                "allocated": fields[2],
                "free": fields[3],
                "fragmentation": fields[4],
                "capacity": fields[5],
                "health": fields[6],
            })
    return pools


def parse_zpool_status(pool: str) -> dict:
    result = run(["zpool", "status", pool])
    if not result.ok:
        return {"error": result.stderr.strip()}

    output = result.stdout
    info = {
        "raw": output,
        "pool": pool,
        "state": "",
        "scan": "",
        "config": "",
        "errors": "",
    }

    state_match = re.search(r"state:\s*(.+)", output)
    if state_match:
        info["state"] = state_match.group(1).strip()

    scan_match = re.search(r"scan:\s*(.+?)(?:\n\s{2,}\S|\nconfig:)", output, re.DOTALL)
    if scan_match:
        info["scan"] = scan_match.group(1).strip()

    config_match = re.search(r"config:\s*\n(.+?)(?:\nerrors:)", output, re.DOTALL)
    if config_match:
        info["config"] = config_match.group(1).strip()

    errors_match = re.search(r"errors:\s*(.+)", output)
    if errors_match:
        info["errors"] = errors_match.group(1).strip()

    return info


def parse_zfs_list(dataset: str | None = None) -> list[dict]:
    cmd = ["zfs", "list", "-H", "-o", "name,used,avail,refer,mountpoint"]
    if dataset:
        cmd.extend(["-r", dataset])
    result = run(cmd)
    if not result.ok:
        return []
    datasets = []
    for line in result.stdout.strip().splitlines():
        fields = line.split("\t")
        if len(fields) >= 5:
            datasets.append({
                "name": fields[0],
                "used": fields[1],
                "available": fields[2],
                "refer": fields[3],
                "mountpoint": fields[4],
            })
    return datasets


def parse_zfs_get(target: str, properties: list[str]) -> dict:
    props = ",".join(properties)
    result = run(["zfs", "get", "-H", "-o", "property,value", props, target])
    if not result.ok:
        return {}
    values = {}
    for line in result.stdout.strip().splitlines():
        parts = line.split("\t", 1)
        if len(parts) == 2:
            values[parts[0]] = parts[1]
    return values


def list_snapshots(dataset: str | None = None) -> list[dict]:
    cmd = ["zfs", "list", "-H", "-t", "snapshot", "-o", "name,used,refer,creation"]
    if dataset:
        cmd.extend(["-r", dataset])
    result = run(cmd)
    if not result.ok:
        return []
    snapshots = []
    for line in result.stdout.strip().splitlines():
        fields = line.split("\t")
        if len(fields) >= 4:
            name = fields[0]
            ds, snap = name.rsplit("@", 1) if "@" in name else (name, "")
            snapshots.append({
                "name": name,
                "dataset": ds,
                "snapshot": snap,
                "used": fields[1],
                "refer": fields[2],
                "creation": fields[3],
            })
    return snapshots


def get_pool_disks() -> dict[str, list[str]]:
    result = run(["zpool", "list", "-H", "-o", "name"])
    if not result.ok:
        return {}
    pool_disks = {}
    for pool in result.stdout.strip().splitlines():
        pool = pool.strip()
        status = run(["zpool", "status", pool])
        if status.ok:
            disks = re.findall(r"\b(sd[a-z]+|nvme\d+n\d+|da\d+)\b", status.stdout)
            pool_disks[pool] = disks
    return pool_disks


def list_available_disks() -> list[dict]:
    pool_disks = get_pool_disks()
    used_disks = set()
    for disks in pool_disks.values():
        used_disks.update(disks)

    # Try JSON mode first for richer info
    result = run(["lsblk", "-J", "-d", "-b", "-o", "NAME,SIZE,TYPE,MODEL,SERIAL,ROTA,TRAN", "-e", "7,11"])
    if result.ok:
        try:
            data = json.loads(result.stdout)
            available = []
            for dev in data.get("blockdevices", []):
                if dev.get("type") == "disk" and dev["name"] not in used_disks:
                    size_bytes = dev.get("size")
                    available.append({
                        "name": dev["name"],
                        "path": f"/dev/{dev['name']}",
                        "size": _format_bytes(size_bytes) if size_bytes else "",
                        "size_bytes": size_bytes or 0,
                        "model": (dev.get("model") or "").strip(),
                        "serial": (dev.get("serial") or "").strip(),
                        "rota": bool(dev.get("rota")),
                        "tran": (dev.get("tran") or "").strip(),
                    })
            return available
        except (json.JSONDecodeError, KeyError):
            pass

    # Fallback to text mode
    result = run(["lsblk", "-d", "-n", "-o", "NAME,SIZE,TYPE,MODEL", "-e", "7,11"])
    if not result.ok:
        return []

    available = []
    for line in result.stdout.strip().splitlines():
        parts = line.split(None, 3)
        if len(parts) >= 3 and parts[2] == "disk":
            name = parts[0]
            if name not in used_disks:
                available.append({
                    "name": name,
                    "path": f"/dev/{name}",
                    "size": parts[1],
                    "size_bytes": 0,
                    "model": parts[3].strip() if len(parts) > 3 else "",
                    "serial": "",
                    "rota": True,
                    "tran": "",
                })
    return available


def _format_bytes(b) -> str:
    try:
        b = int(b)
    except (TypeError, ValueError):
        return ""
    for unit in ("B", "K", "M", "G", "T", "P"):
        if abs(b) < 1024:
            return f"{b:.1f}{unit}" if unit != "B" else f"{b}{unit}"
        b /= 1024
    return f"{b:.1f}E"
