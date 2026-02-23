import logging
import subprocess
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.database import get_db
from backend.utils.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/replication", tags=["replication"], dependencies=[Depends(get_current_user)])


class ReplicationCreate(BaseModel):
    name: str
    source_dataset: str
    destination_host: str
    destination_port: int = 22
    destination_user: str = "root"
    destination_dataset: str
    recursive: bool = False
    incremental: bool = True
    ssh_key_path: str = ""
    schedule: str = "0 0 * * *"
    enabled: bool = True


class ReplicationUpdate(BaseModel):
    name: str | None = None
    source_dataset: str | None = None
    destination_host: str | None = None
    destination_port: int | None = None
    destination_user: str | None = None
    destination_dataset: str | None = None
    recursive: bool | None = None
    incremental: bool | None = None
    ssh_key_path: str | None = None
    schedule: str | None = None
    enabled: bool | None = None


@router.get("")
def list_replication_tasks():
    db = get_db()
    try:
        rows = db.execute("SELECT * FROM zfs_replication_tasks ORDER BY id").fetchall()
        return [dict(r) for r in rows]
    finally:
        db.close()


@router.get("/{task_id}")
def get_replication_task(task_id: int):
    db = get_db()
    try:
        row = db.execute("SELECT * FROM zfs_replication_tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Replication task not found")
        return dict(row)
    finally:
        db.close()


@router.post("")
def create_replication_task(req: ReplicationCreate, username: str = Depends(get_current_user)):
    db = get_db()
    try:
        cursor = db.execute(
            """INSERT INTO zfs_replication_tasks
               (name, source_dataset, destination_host, destination_port, destination_user,
                destination_dataset, recursive, incremental, ssh_key_path, schedule, enabled)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (req.name, req.source_dataset, req.destination_host, req.destination_port,
             req.destination_user, req.destination_dataset, int(req.recursive),
             int(req.incremental), req.ssh_key_path, req.schedule, int(req.enabled)),
        )
        db.commit()
        task_id = cursor.lastrowid
    finally:
        db.close()

    logger.info(f"User '{username}' created replication task '{req.name}' (id={task_id})")
    return {"message": "Replication task created", "id": task_id}


@router.put("/{task_id}")
def update_replication_task(task_id: int, req: ReplicationUpdate, username: str = Depends(get_current_user)):
    db = get_db()
    try:
        existing = db.execute("SELECT * FROM zfs_replication_tasks WHERE id = ?", (task_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Replication task not found")

        updates = {}
        for field in ("name", "source_dataset", "destination_host", "destination_port",
                       "destination_user", "destination_dataset", "ssh_key_path", "schedule"):
            val = getattr(req, field)
            if val is not None:
                updates[field] = val
        for field in ("recursive", "incremental", "enabled"):
            val = getattr(req, field)
            if val is not None:
                updates[field] = int(val)

        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            db.execute(f"UPDATE zfs_replication_tasks SET {set_clause} WHERE id = ?", (*updates.values(), task_id))
            db.commit()
    finally:
        db.close()

    logger.info(f"User '{username}' updated replication task id={task_id}")
    return {"message": "Replication task updated"}


@router.delete("/{task_id}")
def delete_replication_task(task_id: int, username: str = Depends(get_current_user)):
    db = get_db()
    try:
        result = db.execute("DELETE FROM zfs_replication_tasks WHERE id = ?", (task_id,))
        db.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Replication task not found")
    finally:
        db.close()

    logger.info(f"User '{username}' deleted replication task id={task_id}")
    return {"message": "Replication task deleted"}


@router.post("/{task_id}/run")
def run_replication_task(task_id: int, username: str = Depends(get_current_user)):
    db = get_db()
    try:
        row = db.execute("SELECT * FROM zfs_replication_tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Replication task not found")
        task = dict(row)
    finally:
        db.close()

    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    snap_name = f"{task['source_dataset']}@repl-{timestamp}"

    # Create snapshot
    snap_cmd = "zfs snapshot"
    if task["recursive"]:
        snap_cmd += " -r"
    snap_cmd += f" {snap_name}"

    # Build send/receive pipe
    send_cmd = "zfs send"
    if task["recursive"]:
        send_cmd += " -R"
    if task["incremental"] and task["last_snapshot"]:
        send_cmd += f" -i {task['last_snapshot']}"
    send_cmd += f" {snap_name}"

    ssh_cmd = f"ssh -p {task['destination_port']}"
    if task["ssh_key_path"]:
        ssh_cmd += f" -i {task['ssh_key_path']}"
    ssh_cmd += f" {task['destination_user']}@{task['destination_host']}"

    recv_cmd = f"zfs receive -F {task['destination_dataset']}"

    full_cmd = f"{snap_cmd} && {send_cmd} | {ssh_cmd} {recv_cmd}"

    try:
        proc = subprocess.run(
            ["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--", "sh", "-c", full_cmd],
            capture_output=True, text=True, timeout=7200,
        )
        result_text = proc.stdout or proc.stderr or f"Exit code: {proc.returncode}"
        success = proc.returncode == 0
    except subprocess.TimeoutExpired:
        result_text = "Replication timed out after 2 hours"
        success = False
    except Exception as e:
        result_text = str(e)
        success = False

    db = get_db()
    try:
        if success:
            db.execute(
                "UPDATE zfs_replication_tasks SET last_run = ?, last_result = ?, last_snapshot = ? WHERE id = ?",
                (datetime.now().isoformat(), result_text[:1000], snap_name, task_id),
            )
        else:
            db.execute(
                "UPDATE zfs_replication_tasks SET last_run = ?, last_result = ? WHERE id = ?",
                (datetime.now().isoformat(), result_text[:1000], task_id),
            )
        db.commit()
    finally:
        db.close()

    if not success:
        try:
            from backend.utils.email import send_alert
            send_alert("replication_failures",
                        f"Replication failed: {task['name']}",
                        f"Task: {task['name']}\nSource: {task['source_dataset']}\n"
                        f"Destination: {task['destination_host']}:{task['destination_dataset']}\n"
                        f"Error: {result_text[:500]}")
        except Exception:
            pass

    logger.info(f"User '{username}' ran replication task id={task_id} (success={success})")
    return {"message": "Replication task executed", "result": result_text[:1000]}
