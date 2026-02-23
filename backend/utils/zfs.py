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

    # Add structured vdev tree
    info["vdevs"] = parse_vdev_tree(output)

    return info


def parse_vdev_tree(status_output: str) -> list[dict]:
    """Parse zpool status config section into a structured vdev tree.

    Returns a list of top-level entries (vdevs, spares, logs, cache sections).
    Each vdev has: name, state, read, write, cksum, type, children[].
    Leaf disks have: name, state, read, write, cksum, type='disk'.
    """
    # Extract config section
    config_match = re.search(r"config:\s*\n(.+?)(?:\nerrors:)", status_output, re.DOTALL)
    if not config_match:
        return []

    lines = config_match.group(1).splitlines()
    if not lines:
        return []

    # Skip the header line (NAME STATE READ WRITE CKSUM)
    data_lines = []
    for line in lines:
        stripped = line.strip()
        if not stripped or (stripped.startswith("NAME") and "STATE" in stripped):
            continue
        data_lines.append(line)

    if not data_lines:
        return []

    # Parse each line: measure indent using total leading whitespace
    # zpool status uses tab(s) then spaces, e.g. "\t  mirror-0" = tab + 2 spaces
    entries = []
    for line in data_lines:
        # Expand tabs to 8 spaces (standard tab width), then count leading spaces
        expanded = line.expandtabs(8)
        content = expanded.lstrip(" ")
        indent = len(expanded) - len(content)
        parts = content.split()
        if not parts:
            continue

        name = parts[0]
        state = parts[1] if len(parts) > 1 else ""
        read_err = parts[2] if len(parts) > 2 else "0"
        write_err = parts[3] if len(parts) > 3 else "0"
        cksum_err = parts[4] if len(parts) > 4 else "0"

        # Determine node type
        if name in ("spares", "logs", "cache"):
            node_type = "section"
        elif re.match(r"(mirror|raidz[123]?|stripe|replacing)-?\d*", name):
            node_type = "vdev"
        else:
            node_type = "disk"

        entries.append({
            "indent": indent,
            "name": name,
            "state": state,
            "read": read_err,
            "write": write_err,
            "cksum": cksum_err,
            "type": node_type,
            "children": [],
        })

    # Build tree using indent levels
    # The pool root is at indent level 1, vdevs at 2, disks at 3, etc.
    # We skip the pool root itself and build from vdevs down.
    if not entries:
        return []

    root_indent = entries[0]["indent"]  # pool name line
    result = []
    stack = [{"indent": root_indent - 1, "children": result}]

    for entry in entries[1:]:  # skip pool root
        # Pop stack until we find the parent
        while stack and entry["indent"] <= stack[-1]["indent"]:
            stack.pop()

        if stack:
            stack[-1]["children"].append(entry)

        stack.append({"indent": entry["indent"], "children": entry["children"]})

    return result


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


def get_pool_disk_roles() -> dict[str, dict[str, list[str]]]:
    """Parse zpool status to get disk roles (data, spare, log, cache) per pool."""
    result = run(["zpool", "list", "-H", "-o", "name"])
    if not result.ok:
        return {}
    pool_roles = {}
    for pool in result.stdout.strip().splitlines():
        pool = pool.strip()
        status = run(["zpool", "status", pool])
        if not status.ok:
            continue
        roles = {"data": [], "spare": [], "log": [], "cache": []}
        current_role = "data"
        in_config = False
        for line in status.stdout.splitlines():
            stripped = line.strip()
            if stripped.startswith("config:"):
                in_config = True
                continue
            if stripped.startswith("errors:"):
                break
            if not in_config:
                continue
            if stripped.startswith("NAME") and "STATE" in stripped:
                continue
            if not stripped or stripped == pool:
                continue
            lower = stripped.lower()
            if lower.startswith("spares"):
                current_role = "spare"
                continue
            if lower.startswith("logs"):
                current_role = "log"
                continue
            if lower.startswith("cache"):
                current_role = "cache"
                continue
            # Check for vdev types (mirror, raidz, etc.) — skip these lines
            parts = stripped.split()
            name = parts[0]
            if name.startswith(("mirror", "raidz", "stripe")):
                continue
            # Match disk names
            disk_match = re.match(r"(sd[a-z]+|nvme\d+n\d+|da\d+)", name)
            if disk_match:
                roles[current_role].append(disk_match.group(1))
        pool_roles[pool] = roles
    return pool_roles


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


def get_boot_disk() -> str | None:
    """Detect the host's boot disk via /proc/1/mounts (host init's mount namespace)."""
    try:
        with open("/proc/1/mounts") as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 2 and parts[1] == "/":
                    match = re.match(r"/dev/(sd[a-z]+|nvme\d+n\d+|da\d+)", parts[0])
                    if match:
                        return match.group(1)
    except OSError:
        pass
    return None


def list_available_disks() -> list[dict]:
    pool_roles = get_pool_disk_roles()
    used_disks = set()
    for roles in pool_roles.values():
        # Exclude data, log, and cache disks — but NOT spares
        used_disks.update(roles.get("data", []))
        used_disks.update(roles.get("log", []))
        used_disks.update(roles.get("cache", []))

    boot_disk = get_boot_disk()
    if boot_disk:
        used_disks.add(boot_disk)

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
