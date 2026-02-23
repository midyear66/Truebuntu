import re
from pathlib import Path

EXPORTS_PATH = "/etc/exports"


def parse_exports(path: str = EXPORTS_PATH) -> list[dict]:
    exports = []
    text = Path(path).read_text()
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        match = re.match(r'^(\S+)\s+(.+)$', stripped)
        if match:
            export_path = match.group(1)
            rest = match.group(2)
            clients = []
            for client_match in re.finditer(r'(\S+)\(([^)]*)\)', rest):
                clients.append({
                    "host": client_match.group(1),
                    "options": client_match.group(2),
                })
            exports.append({
                "path": export_path,
                "clients": clients,
            })
    return exports


def write_exports(exports: list[dict], path: str = EXPORTS_PATH):
    lines = ["# NFS Exports - managed by Truebuntu\n"]
    for export in exports:
        client_parts = []
        for client in export["clients"]:
            client_parts.append(f"{client['host']}({client['options']})")
        line = f"{export['path']}  {' '.join(client_parts)}\n"
        lines.append(line)
    Path(path).write_text("".join(lines))


def add_export(export_path: str, clients: list[dict], path: str = EXPORTS_PATH):
    exports = parse_exports(path)
    for e in exports:
        if e["path"] == export_path:
            raise ValueError(f"Export for '{export_path}' already exists")
    exports.append({"path": export_path, "clients": clients})
    write_exports(exports, path)


def update_export(export_path: str, clients: list[dict], path: str = EXPORTS_PATH):
    exports = parse_exports(path)
    found = False
    for e in exports:
        if e["path"] == export_path:
            e["clients"] = clients
            found = True
            break
    if not found:
        raise ValueError(f"Export for '{export_path}' not found")
    write_exports(exports, path)


def remove_export(export_path: str, path: str = EXPORTS_PATH):
    exports = parse_exports(path)
    new_exports = [e for e in exports if e["path"] != export_path]
    if len(new_exports) == len(exports):
        raise ValueError(f"Export for '{export_path}' not found")
    write_exports(new_exports, path)
