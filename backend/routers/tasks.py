import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.database import get_db
from backend.utils.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tasks", tags=["tasks"], dependencies=[Depends(get_current_user)])

VALID_TYPES = {"scrub", "rsync", "smart_test", "rclone_sync", "custom"}


class TaskCreateRequest(BaseModel):
    name: str
    type: str
    schedule: str | None = None
    config: dict = {}
    enabled: bool = True


class TaskUpdateRequest(BaseModel):
    name: str | None = None
    schedule: str | None = None
    config: dict | None = None
    enabled: bool | None = None


@router.get("")
def list_tasks():
    db = get_db()
    try:
        rows = db.execute("SELECT * FROM tasks ORDER BY id").fetchall()
        result = []
        for row in rows:
            task = dict(row)
            task["config"] = json.loads(task["config"])
            result.append(task)
        return result
    finally:
        db.close()


@router.get("/{task_id}")
def get_task(task_id: int):
    db = get_db()
    try:
        row = db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Task not found")
        task = dict(row)
        task["config"] = json.loads(task["config"])
        return task
    finally:
        db.close()


@router.post("")
def create_task(req: TaskCreateRequest, username: str = Depends(get_current_user)):
    if req.type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid task type: {req.type}")

    db = get_db()
    try:
        cursor = db.execute(
            "INSERT INTO tasks (name, type, schedule, config, enabled) VALUES (?, ?, ?, ?, ?)",
            (req.name, req.type, req.schedule, json.dumps(req.config), int(req.enabled)),
        )
        db.commit()
        task_id = cursor.lastrowid
    finally:
        db.close()

    logger.info(f"User '{username}' created task '{req.name}' (id={task_id}, type={req.type})")
    return {"message": "Task created", "id": task_id}


@router.put("/{task_id}")
def update_task(task_id: int, req: TaskUpdateRequest, username: str = Depends(get_current_user)):
    db = get_db()
    try:
        existing = db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Task not found")

        updates = {}
        if req.name is not None:
            updates["name"] = req.name
        if req.schedule is not None:
            updates["schedule"] = req.schedule
        if req.config is not None:
            updates["config"] = json.dumps(req.config)
        if req.enabled is not None:
            updates["enabled"] = int(req.enabled)

        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            db.execute(
                f"UPDATE tasks SET {set_clause} WHERE id = ?",
                (*updates.values(), task_id),
            )
            db.commit()
    finally:
        db.close()

    logger.info(f"User '{username}' updated task id={task_id}")
    return {"message": "Task updated"}


@router.delete("/{task_id}")
def delete_task(task_id: int, username: str = Depends(get_current_user)):
    db = get_db()
    try:
        result = db.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        db.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Task not found")
    finally:
        db.close()

    logger.info(f"User '{username}' deleted task id={task_id}")
    return {"message": "Task deleted"}


@router.post("/{task_id}/run")
def run_task(task_id: int, username: str = Depends(get_current_user)):
    db = get_db()
    try:
        row = db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Task not found")
        task = dict(row)
        task["config"] = json.loads(task["config"])
    finally:
        db.close()

    from datetime import datetime
    from backend.utils.jobs import JobManager

    task_type = task["type"]
    config = task["config"]
    cmd = None
    timeout = 60

    if task_type == "scrub":
        pool = config.get("pool", "")
        if not pool:
            raise HTTPException(status_code=400, detail="No pool configured")
        cmd = ["zpool", "scrub", pool]
    elif task_type == "smart_test":
        disk = config.get("disk", "")
        test_type = config.get("test_type", "short")
        if not disk:
            raise HTTPException(status_code=400, detail="No disk configured")
        cmd = ["smartctl", "-t", test_type, f"/dev/{disk}"]
    elif task_type == "rclone_sync":
        source = config.get("source", "")
        dest = config.get("dest", "")
        if not source or not dest:
            raise HTTPException(status_code=400, detail="No source/dest configured")
        cmd = ["rclone", "sync", source, dest, "--progress"]
        timeout = 3600
    elif task_type == "custom":
        raise HTTPException(status_code=400, detail="Custom task execution not supported")
    else:
        raise HTTPException(status_code=400, detail=f"Unknown task type: {task_type}")

    def on_complete(job_id, status, stdout, stderr, returncode):
        result_text = stdout or stderr or f"Exit code: {returncode}"
        db2 = get_db()
        try:
            db2.execute(
                "UPDATE tasks SET last_run = ?, last_result = ? WHERE id = ?",
                (datetime.now().isoformat(), result_text[:1000], task_id),
            )
            db2.commit()
        finally:
            db2.close()

    mgr = JobManager()
    try:
        job_id = mgr.submit(
            job_type=f"task:{task_type}",
            description=f"Task: {task['name']} ({task_type})",
            resource=f"task:{task_id}",
            started_by=username,
            cmd=cmd,
            timeout=timeout,
            on_complete=on_complete,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    logger.info(f"User '{username}' ran task id={task_id} ({task_type}) (job {job_id})")
    return {"job_id": job_id, "message": "Task started"}
