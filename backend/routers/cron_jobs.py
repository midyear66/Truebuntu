import logging
import subprocess
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.database import get_db
from backend.utils.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/cron-jobs", tags=["cron-jobs"], dependencies=[Depends(get_current_user)])


class CronJobCreate(BaseModel):
    name: str
    command: str
    schedule: str = "0 * * * *"
    user: str = "root"
    description: str = ""
    enabled: bool = True


class CronJobUpdate(BaseModel):
    name: str | None = None
    command: str | None = None
    schedule: str | None = None
    user: str | None = None
    description: str | None = None
    enabled: bool | None = None


@router.get("")
def list_cron_jobs():
    db = get_db()
    try:
        rows = db.execute("SELECT * FROM cron_jobs ORDER BY id").fetchall()
        return [dict(r) for r in rows]
    finally:
        db.close()


@router.get("/{job_id}")
def get_cron_job(job_id: int):
    db = get_db()
    try:
        row = db.execute("SELECT * FROM cron_jobs WHERE id = ?", (job_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Cron job not found")
        return dict(row)
    finally:
        db.close()


@router.post("")
def create_cron_job(req: CronJobCreate, username: str = Depends(get_current_user)):
    db = get_db()
    try:
        cursor = db.execute(
            """INSERT INTO cron_jobs (name, command, schedule, user, description, enabled)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (req.name, req.command, req.schedule, req.user, req.description, int(req.enabled)),
        )
        db.commit()
        job_id = cursor.lastrowid
    finally:
        db.close()

    logger.info(f"User '{username}' created cron job '{req.name}' (id={job_id})")
    return {"message": "Cron job created", "id": job_id}


@router.put("/{job_id}")
def update_cron_job(job_id: int, req: CronJobUpdate, username: str = Depends(get_current_user)):
    db = get_db()
    try:
        existing = db.execute("SELECT * FROM cron_jobs WHERE id = ?", (job_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Cron job not found")

        updates = {}
        for field in ("name", "command", "schedule", "user", "description"):
            val = getattr(req, field)
            if val is not None:
                updates[field] = val
        if req.enabled is not None:
            updates["enabled"] = int(req.enabled)

        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            db.execute(f"UPDATE cron_jobs SET {set_clause} WHERE id = ?", (*updates.values(), job_id))
            db.commit()
    finally:
        db.close()

    logger.info(f"User '{username}' updated cron job id={job_id}")
    return {"message": "Cron job updated"}


@router.delete("/{job_id}")
def delete_cron_job(job_id: int, username: str = Depends(get_current_user)):
    db = get_db()
    try:
        result = db.execute("DELETE FROM cron_jobs WHERE id = ?", (job_id,))
        db.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Cron job not found")
    finally:
        db.close()

    logger.info(f"User '{username}' deleted cron job id={job_id}")
    return {"message": "Cron job deleted"}


@router.post("/{job_id}/run")
def run_cron_job(job_id: int, username: str = Depends(get_current_user)):
    db = get_db()
    try:
        row = db.execute("SELECT * FROM cron_jobs WHERE id = ?", (job_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Cron job not found")
        job = dict(row)
    finally:
        db.close()

    # Use subprocess directly to allow shell metacharacters in commands
    try:
        proc = subprocess.run(
            ["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--", "sh", "-c", job["command"]],
            capture_output=True, text=True, timeout=300,
        )
        result_text = proc.stdout or proc.stderr or f"Exit code: {proc.returncode}"
    except subprocess.TimeoutExpired:
        result_text = "Command timed out after 300s"
    except Exception as e:
        result_text = str(e)

    db = get_db()
    try:
        db.execute(
            "UPDATE cron_jobs SET last_run = ?, last_result = ? WHERE id = ?",
            (datetime.now().isoformat(), result_text[:1000], job_id),
        )
        db.commit()
    finally:
        db.close()

    logger.info(f"User '{username}' ran cron job id={job_id}")
    return {"message": "Cron job executed", "result": result_text[:1000]}
