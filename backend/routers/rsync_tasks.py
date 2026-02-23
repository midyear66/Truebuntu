import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.database import get_db
from backend.utils.auth import get_current_user
from backend.utils.shell import run as shell_run

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/rsync-tasks", tags=["rsync-tasks"], dependencies=[Depends(get_current_user)])


class RsyncTaskCreate(BaseModel):
    name: str
    source: str
    destination: str
    direction: str = "push"
    mode: str = "ssh"
    remote_host: str = ""
    remote_port: int = 22
    remote_user: str = "root"
    remote_path: str = ""
    schedule: str = "0 0 * * *"
    extra_args: str = ""
    recursive: bool = True
    archive: bool = True
    compress: bool = True
    delete_dest: bool = False
    enabled: bool = True


class RsyncTaskUpdate(BaseModel):
    name: str | None = None
    source: str | None = None
    destination: str | None = None
    direction: str | None = None
    mode: str | None = None
    remote_host: str | None = None
    remote_port: int | None = None
    remote_user: str | None = None
    remote_path: str | None = None
    schedule: str | None = None
    extra_args: str | None = None
    recursive: bool | None = None
    archive: bool | None = None
    compress: bool | None = None
    delete_dest: bool | None = None
    enabled: bool | None = None


@router.get("")
def list_rsync_tasks():
    db = get_db()
    try:
        rows = db.execute("SELECT * FROM rsync_tasks ORDER BY id").fetchall()
        return [dict(r) for r in rows]
    finally:
        db.close()


@router.get("/{task_id}")
def get_rsync_task(task_id: int):
    db = get_db()
    try:
        row = db.execute("SELECT * FROM rsync_tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Rsync task not found")
        return dict(row)
    finally:
        db.close()


@router.post("")
def create_rsync_task(req: RsyncTaskCreate, username: str = Depends(get_current_user)):
    db = get_db()
    try:
        cursor = db.execute(
            """INSERT INTO rsync_tasks
               (name, source, destination, direction, mode, remote_host, remote_port,
                remote_user, remote_path, schedule, extra_args, recursive, archive,
                compress, delete_dest, enabled)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (req.name, req.source, req.destination, req.direction, req.mode,
             req.remote_host, req.remote_port, req.remote_user, req.remote_path,
             req.schedule, req.extra_args, int(req.recursive), int(req.archive),
             int(req.compress), int(req.delete_dest), int(req.enabled)),
        )
        db.commit()
        task_id = cursor.lastrowid
    finally:
        db.close()

    logger.info(f"User '{username}' created rsync task '{req.name}' (id={task_id})")
    return {"message": "Rsync task created", "id": task_id}


@router.put("/{task_id}")
def update_rsync_task(task_id: int, req: RsyncTaskUpdate, username: str = Depends(get_current_user)):
    db = get_db()
    try:
        existing = db.execute("SELECT * FROM rsync_tasks WHERE id = ?", (task_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Rsync task not found")

        updates = {}
        for field in ("name", "source", "destination", "direction", "mode",
                       "remote_host", "remote_port", "remote_user", "remote_path",
                       "schedule", "extra_args"):
            val = getattr(req, field)
            if val is not None:
                updates[field] = val
        for field in ("recursive", "archive", "compress", "delete_dest", "enabled"):
            val = getattr(req, field)
            if val is not None:
                updates[field] = int(val)

        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            db.execute(f"UPDATE rsync_tasks SET {set_clause} WHERE id = ?", (*updates.values(), task_id))
            db.commit()
    finally:
        db.close()

    logger.info(f"User '{username}' updated rsync task id={task_id}")
    return {"message": "Rsync task updated"}


@router.delete("/{task_id}")
def delete_rsync_task(task_id: int, username: str = Depends(get_current_user)):
    db = get_db()
    try:
        result = db.execute("DELETE FROM rsync_tasks WHERE id = ?", (task_id,))
        db.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Rsync task not found")
    finally:
        db.close()

    logger.info(f"User '{username}' deleted rsync task id={task_id}")
    return {"message": "Rsync task deleted"}


@router.post("/{task_id}/run")
def run_rsync_task(task_id: int, username: str = Depends(get_current_user)):
    db = get_db()
    try:
        row = db.execute("SELECT * FROM rsync_tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Rsync task not found")
        task = dict(row)
    finally:
        db.close()

    # Build rsync command
    args = ["rsync"]
    if task["archive"]:
        args.append("-a")
    if task["recursive"] and not task["archive"]:
        args.append("-r")
    if task["compress"]:
        args.append("-z")
    if task["delete_dest"]:
        args.append("--delete")

    if task["extra_args"]:
        args.extend(task["extra_args"].split())

    if task["mode"] == "ssh" and task["remote_host"]:
        args.extend(["-e", f"ssh -p {task['remote_port']}"])
        remote = f"{task['remote_user']}@{task['remote_host']}:{task['remote_path']}"
        if task["direction"] == "push":
            args.extend([task["source"], remote])
        else:
            args.extend([remote, task["destination"]])
    else:
        args.extend([task["source"], task["destination"]])

    result = shell_run(args, timeout=3600)
    result_text = result.stdout or result.stderr or f"Exit code: {result.returncode}"

    db = get_db()
    try:
        db.execute(
            "UPDATE rsync_tasks SET last_run = ?, last_result = ? WHERE id = ?",
            (datetime.now().isoformat(), result_text[:1000], task_id),
        )
        db.commit()
    finally:
        db.close()

    logger.info(f"User '{username}' ran rsync task id={task_id}")
    return {"message": "Rsync task executed", "result": result_text[:1000]}
