import json
import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends

from backend.database import get_db
from backend.utils.auth import get_current_admin
from backend.utils.shell import run

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/updates", tags=["updates"], dependencies=[Depends(get_current_admin)])

UPGRADE_RE = re.compile(
    r"^(.+?)/\S+\s+(\S+)\s+\S+\s+\[upgradable from:\s+(\S+)\]$"
)


def _save_setting(key: str, value: str):
    db = get_db()
    try:
        db.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            (key, value),
        )
        db.commit()
    finally:
        db.close()


def _get_setting(key: str) -> str | None:
    db = get_db()
    try:
        row = db.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else None
    finally:
        db.close()


def _parse_upgradable(output: str) -> list[dict]:
    packages = []
    for line in output.strip().splitlines():
        if line.startswith("Listing") or line.startswith("WARNING"):
            continue
        m = UPGRADE_RE.match(line)
        if m:
            packages.append({
                "name": m.group(1),
                "new_version": m.group(2),
                "current_version": m.group(3),
            })
    return packages


@router.post("/check")
def check_updates(username: str = Depends(get_current_admin)):
    # Run apt update
    update_result = run([
        "nsenter", "-t", "1", "-m", "-u", "-n", "-i",
        "apt-get", "update", "-qq",
    ], timeout=120)
    if not update_result.ok:
        raise HTTPException(status_code=500, detail=f"apt update failed: {update_result.stderr.strip()}")

    # Get upgradable list
    list_result = run([
        "nsenter", "-t", "1", "-m", "-u", "-n", "-i",
        "apt", "list", "--upgradable",
    ], timeout=60)
    if not list_result.ok:
        raise HTTPException(status_code=500, detail=f"apt list failed: {list_result.stderr.strip()}")

    packages = _parse_upgradable(list_result.stdout)

    # Cache results
    _save_setting("updates_available", json.dumps(packages))
    _save_setting("updates_last_check", datetime.now(timezone.utc).isoformat())

    return {"packages": packages, "count": len(packages)}


@router.get("/available")
def get_available(username: str = Depends(get_current_admin)):
    cached = _get_setting("updates_available")
    last_check = _get_setting("updates_last_check")
    packages = json.loads(cached) if cached else []
    return {
        "packages": packages,
        "count": len(packages),
        "last_check": last_check,
    }


_NOISE_PATTERNS = (
    "debconf:", "needrestart", "(Reading database",
    "Processing triggers", "update-initramfs",
)


def _clean_apt_output(output: str) -> str:
    """Remove noisy dpkg/debconf lines that confuse users."""
    lines = []
    for line in output.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if any(stripped.startswith(p) for p in _NOISE_PATTERNS):
            continue
        lines.append(line)
    return "\n".join(lines)


@router.post("/apply")
def apply_updates(username: str = Depends(get_current_admin)):
    result = run([
        "nsenter", "-t", "1", "-m", "-u", "-n", "-i",
        "env", "DEBIAN_FRONTEND=noninteractive",
        "apt-get", "upgrade", "-y", "-o", "Dpkg::Options::=--force-confold",
    ], timeout=300)
    if not result.ok:
        # Filter misleading messages from stderr before reporting
        stderr = result.stderr or ""
        for noise in _NOISE_PATTERNS:
            stderr = "\n".join(l for l in stderr.splitlines() if noise not in l)
        stderr = stderr.strip()
        if stderr:
            raise HTTPException(status_code=500, detail=f"Upgrade failed: {stderr}")
        # If stderr was only noise but rc != 0, still report
        raise HTTPException(status_code=500, detail="Upgrade completed with warnings")

    # Clear cache after applying
    _save_setting("updates_available", "[]")
    _save_setting("updates_last_check", datetime.now(timezone.utc).isoformat())

    return {"message": "Updates applied", "output": _clean_apt_output(result.stdout)}
