import logging
import subprocess
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.database import get_db
from backend.utils.auth import get_current_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/init-shutdown", tags=["init-shutdown"], dependencies=[Depends(get_current_admin)])

VALID_TYPES = {"init", "shutdown"}
VALID_WHEN = {"pre", "post"}


class ScriptCreate(BaseModel):
    name: str
    type: str = "init"
    when_run: str = "post"
    command: str
    timeout: int = 30
    enabled: bool = True


class ScriptUpdate(BaseModel):
    name: str | None = None
    type: str | None = None
    when_run: str | None = None
    command: str | None = None
    timeout: int | None = None
    enabled: bool | None = None


@router.get("")
def list_scripts():
    db = get_db()
    try:
        rows = db.execute("SELECT * FROM init_shutdown_scripts ORDER BY id").fetchall()
        return [dict(r) for r in rows]
    finally:
        db.close()


@router.get("/{script_id}")
def get_script(script_id: int):
    db = get_db()
    try:
        row = db.execute("SELECT * FROM init_shutdown_scripts WHERE id = ?", (script_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Script not found")
        return dict(row)
    finally:
        db.close()


@router.post("")
def create_script(req: ScriptCreate, username: str = Depends(get_current_admin)):
    if req.type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid type: {req.type}. Must be init or shutdown")
    if req.when_run not in VALID_WHEN:
        raise HTTPException(status_code=400, detail=f"Invalid when_run: {req.when_run}. Must be pre or post")

    db = get_db()
    try:
        cursor = db.execute(
            """INSERT INTO init_shutdown_scripts (name, type, when_run, command, timeout, enabled)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (req.name, req.type, req.when_run, req.command, req.timeout, int(req.enabled)),
        )
        db.commit()
        script_id = cursor.lastrowid
    finally:
        db.close()

    logger.info(f"User '{username}' created init/shutdown script '{req.name}' (id={script_id})")
    return {"message": "Script created", "id": script_id}


@router.put("/{script_id}")
def update_script(script_id: int, req: ScriptUpdate, username: str = Depends(get_current_admin)):
    if req.type is not None and req.type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid type: {req.type}")
    if req.when_run is not None and req.when_run not in VALID_WHEN:
        raise HTTPException(status_code=400, detail=f"Invalid when_run: {req.when_run}")

    db = get_db()
    try:
        existing = db.execute("SELECT * FROM init_shutdown_scripts WHERE id = ?", (script_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Script not found")

        ALLOWED_FIELDS = {"name", "type", "when_run", "command", "timeout", "enabled"}
        updates = {}
        for field in ("name", "type", "when_run", "command", "timeout"):
            val = getattr(req, field)
            if val is not None:
                updates[field] = val
        if req.enabled is not None:
            updates["enabled"] = int(req.enabled)

        updates = {k: v for k, v in updates.items() if k in ALLOWED_FIELDS}
        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            db.execute(f"UPDATE init_shutdown_scripts SET {set_clause} WHERE id = ?", (*updates.values(), script_id))
            db.commit()
    finally:
        db.close()

    logger.info(f"User '{username}' updated init/shutdown script id={script_id}")
    return {"message": "Script updated"}


@router.delete("/{script_id}")
def delete_script(script_id: int, username: str = Depends(get_current_admin)):
    db = get_db()
    try:
        result = db.execute("DELETE FROM init_shutdown_scripts WHERE id = ?", (script_id,))
        db.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Script not found")
    finally:
        db.close()

    logger.info(f"User '{username}' deleted init/shutdown script id={script_id}")
    return {"message": "Script deleted"}


@router.post("/{script_id}/run")
def run_script(script_id: int, username: str = Depends(get_current_admin)):
    db = get_db()
    try:
        row = db.execute("SELECT * FROM init_shutdown_scripts WHERE id = ?", (script_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Script not found")
        script = dict(row)
    finally:
        db.close()

    try:
        proc = subprocess.run(
            ["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--", "sh", "-c", script["command"]],
            capture_output=True, text=True, timeout=script["timeout"],
        )
        result_text = proc.stdout or proc.stderr or f"Exit code: {proc.returncode}"
    except subprocess.TimeoutExpired:
        result_text = f"Command timed out after {script['timeout']}s"
    except Exception as e:
        result_text = str(e)

    logger.info(f"User '{username}' ran init/shutdown script id={script_id}")
    return {"message": "Script executed", "result": result_text[:1000]}
