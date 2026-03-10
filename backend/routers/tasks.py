import json
import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.database import get_db
from backend.utils.auth import get_current_admin
from backend.routers.rclone import RCLONE_CONFIG

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tasks", tags=["tasks"], dependencies=[Depends(get_current_admin)])

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
def create_task(req: TaskCreateRequest, username: str = Depends(get_current_admin)):
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
def update_task(task_id: int, req: TaskUpdateRequest, username: str = Depends(get_current_admin)):
    db = get_db()
    try:
        existing = db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Task not found")

        ALLOWED_FIELDS = {"name", "schedule", "config", "enabled"}
        updates = {}
        if req.name is not None:
            updates["name"] = req.name
        if req.schedule is not None:
            updates["schedule"] = req.schedule
        if req.config is not None:
            updates["config"] = json.dumps(req.config)
        if req.enabled is not None:
            updates["enabled"] = int(req.enabled)

        updates = {k: v for k, v in updates.items() if k in ALLOWED_FIELDS}
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
def delete_task(task_id: int, username: str = Depends(get_current_admin)):
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
def run_task(task_id: int, username: str = Depends(get_current_admin)):
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
        cmd = _build_rclone_cmd(config)
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


VALID_RCLONE_REMOTE = re.compile(r"^[a-zA-Z0-9_-]+$")
VALID_LOCAL_PATH = re.compile(r"^/[a-zA-Z0-9_./ -]+$")
VALID_BWLIMIT = re.compile(r"^\d+(\.\d+)?[kKmMgG]?$")
VALID_TRANSFER_MODES = {"sync", "copy", "move"}


def _build_rclone_cmd(config: dict) -> list[str]:
    """Build rclone command from rich cloud sync config."""
    direction = config.get("direction", "PUSH").upper()
    transfer_mode = config.get("transfer_mode", "SYNC").lower()
    credential_name = config.get("credential_name", "")
    bucket_folder = config.get("bucket_folder", "")
    local_path = config.get("local_path", "") or config.get("source", "")

    # Backward compat: old-style source/dest
    if not credential_name and config.get("source") and config.get("dest"):
        source = config["source"]
        dest = config["dest"]
        # Prefix local paths with /proc/1/root/ for host filesystem access
        if source.startswith("/"):
            source = f"/proc/1/root{source}"
        if dest.startswith("/"):
            dest = f"/proc/1/root{dest}"
        rclone_cmd = transfer_mode if transfer_mode in VALID_TRANSFER_MODES else "sync"
        return ["rclone", rclone_cmd, source, dest, "--config", RCLONE_CONFIG, "--progress"]

    if not credential_name or not local_path:
        raise HTTPException(status_code=400, detail="Missing remote or local path")

    # Build remote path
    remote_path = f"{credential_name}:{bucket_folder}" if bucket_folder else f"{credential_name}:"

    rclone_cmd = transfer_mode if transfer_mode in VALID_TRANSFER_MODES else "sync"

    # The container doesn't share the host mount namespace, so ZFS mountpoints
    # aren't directly visible. Access them via /proc/1/root/ (host init's root fs).
    host_local_path = f"/proc/1/root{local_path}"

    if direction == "PUSH":
        source, dest = host_local_path, remote_path
    else:
        source, dest = remote_path, host_local_path

    cmd = ["rclone", rclone_cmd, source, dest, "--config", RCLONE_CONFIG, "--progress"]

    if config.get("follow_symlinks"):
        cmd.append("--copy-links")
    transfers = config.get("transfers")
    if transfers and isinstance(transfers, int) and 1 <= transfers <= 64:
        cmd.extend(["--transfers", str(transfers)])
    bwlimit = config.get("bwlimit", "")
    if bwlimit and VALID_BWLIMIT.match(str(bwlimit)):
        cmd.extend(["--bwlimit", str(bwlimit)])
    exclude = config.get("exclude", [])
    if isinstance(exclude, list):
        for pattern in exclude:
            if pattern and isinstance(pattern, str):
                cmd.extend(["--exclude", pattern])

    if config.get("pre_script"):
        logger.warning(f"Pre-script configured but not executed (not yet supported)")
    if config.get("post_script"):
        logger.warning(f"Post-script configured but not executed (not yet supported)")

    return cmd
