import json
import logging
import subprocess

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.database import get_db
from backend.utils.auth import get_current_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/resilver", tags=["resilver"], dependencies=[Depends(get_current_admin)])


class ResilverUpdate(BaseModel):
    enabled: bool = False
    begin_hour: int = 18
    begin_minute: int = 0
    end_hour: int = 6
    end_minute: int = 0
    weekdays: list[int] = [1, 2, 3, 4, 5, 6, 7]


@router.get("")
def get_resilver_config():
    db = get_db()
    try:
        row = db.execute("SELECT * FROM resilver_config WHERE id = 1").fetchone()
        if not row:
            raise HTTPException(status_code=500, detail="Resilver config not initialized")
        config = dict(row)
        config["weekdays"] = json.loads(config["weekdays"])
    finally:
        db.close()

    # Read current kernel resilver delay
    try:
        proc = subprocess.run(
            ["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--",
             "cat", "/sys/module/zfs/parameters/zfs_resilver_delay"],
            capture_output=True, text=True, timeout=10,
        )
        config["current_delay"] = int(proc.stdout.strip()) if proc.returncode == 0 else None
    except Exception:
        config["current_delay"] = None

    return config


@router.put("")
def update_resilver_config(req: ResilverUpdate, username: str = Depends(get_current_admin)):
    db = get_db()
    try:
        db.execute(
            """UPDATE resilver_config SET
               enabled = ?, begin_hour = ?, begin_minute = ?,
               end_hour = ?, end_minute = ?, weekdays = ?
               WHERE id = 1""",
            (int(req.enabled), req.begin_hour, req.begin_minute,
             req.end_hour, req.end_minute, json.dumps(req.weekdays)),
        )
        db.commit()
    finally:
        db.close()

    logger.info(f"User '{username}' updated resilver config")
    return {"message": "Resilver config updated"}
