import re
from pathlib import Path

SMB_CONF_PATH = "/etc/samba/smb.conf"


def parse_smb_conf(path: str = SMB_CONF_PATH) -> dict[str, dict[str, str]]:
    sections: dict[str, dict[str, str]] = {}
    current_section = None

    text = Path(path).read_text()
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith(("#", ";")):
            continue
        section_match = re.match(r"^\[(.+)\]$", stripped)
        if section_match:
            current_section = section_match.group(1)
            sections[current_section] = {}
            continue
        if current_section and "=" in stripped:
            key, _, value = stripped.partition("=")
            sections[current_section][key.strip()] = value.strip()

    return sections


def get_shares(path: str = SMB_CONF_PATH) -> list[dict]:
    sections = parse_smb_conf(path)
    shares = []
    for name, params in sections.items():
        if name.lower() == "global":
            continue
        shares.append({"name": name, **params})
    return shares


def add_share(name: str, params: dict[str, str], path: str = SMB_CONF_PATH):
    text = Path(path).read_text()
    block = f"\n[{name}]\n"
    for key, value in params.items():
        block += f"   {key} = {value}\n"
    Path(path).write_text(text + block)


def update_share(name: str, params: dict[str, str], path: str = SMB_CONF_PATH):
    remove_share(name, path)
    add_share(name, params, path)


def remove_share(name: str, path: str = SMB_CONF_PATH):
    text = Path(path).read_text()
    lines = text.splitlines(keepends=True)
    new_lines = []
    in_section = False
    for line in lines:
        stripped = line.strip()
        if re.match(rf"^\[{re.escape(name)}\]$", stripped, re.IGNORECASE):
            in_section = True
            continue
        if in_section and re.match(r"^\[.+\]$", stripped):
            in_section = False
        if not in_section:
            new_lines.append(line)
    Path(path).write_text("".join(new_lines))
