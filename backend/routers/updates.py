import json
import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends

from backend.database import get_db
from backend.utils.auth import get_current_user
from backend.utils.shell import run

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/updates", tags=["updates"])

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
def check_updates(username: str = Depends(get_current_user)):
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
def get_available(username: str = Depends(get_current_user)):
    cached = _get_setting("updates_available")
    last_check = _get_setting("updates_last_check")
    packages = json.loads(cached) if cached else []
    return {
        "packages": packages,
        "count": len(packages),
        "last_check": last_check,
    }


@router.post("/apply")
def apply_updates(username: str = Depends(get_current_user)):
    result = run([
        "nsenter", "-t", "1", "-m", "-u", "-n", "-i",
        "apt-get", "upgrade", "-y",
    ], timeout=300)
    if not result.ok:
        raise HTTPException(status_code=500, detail=f"Upgrade failed: {result.stderr.strip()}")

    # Clear cache after applying
    _save_setting("updates_available", "[]")
    _save_setting("updates_last_check", datetime.now(timezone.utc).isoformat())

    return {"message": "Updates applied", "output": result.stdout}
