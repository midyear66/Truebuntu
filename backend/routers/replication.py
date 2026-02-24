import logging
import re
import shlex
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.database import get_db
from backend.utils.auth import get_current_user, get_current_admin

logger = logging.getLogger(__name__)

VALID_DATASET = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_./:-]*$")
VALID_HOSTNAME = re.compile(r"^[a-zA-Z0-9._-]+$")
VALID_USERNAME = re.compile(r"^[a-zA-Z0-9._-]+$")
VALID_SSH_KEY_PATH = re.compile(r"^[a-zA-Z0-9_./-]+$")


def _validate_replication_fields(source_dataset: str | None, destination_dataset: str | None,
                                  destination_host: str | None, destination_user: str | None,
                                  destination_port: int | None, ssh_key_path: str | None):
    if source_dataset is not None and not VALID_DATASET.match(source_dataset):
        raise HTTPException(status_code=400, detail="Invalid source dataset name")
    if destination_dataset is not None and not VALID_DATASET.match(destination_dataset):
        raise HTTPException(status_code=400, detail="Invalid destination dataset name")
    if destination_host is not None and not VALID_HOSTNAME.match(destination_host):
        raise HTTPException(status_code=400, detail="Invalid destination hostname")
    if destination_user is not None and not VALID_USERNAME.match(destination_user):
        raise HTTPException(status_code=400, detail="Invalid destination username")
    if destination_port is not None and not (1 <= destination_port <= 65535):
        raise HTTPException(status_code=400, detail="Port must be between 1 and 65535")
    if ssh_key_path is not None and ssh_key_path and not VALID_SSH_KEY_PATH.match(ssh_key_path):
        raise HTTPException(status_code=400, detail="Invalid SSH key path")
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
def create_replication_task(req: ReplicationCreate, username: str = Depends(get_current_admin)):
    _validate_replication_fields(req.source_dataset, req.destination_dataset,
                                  req.destination_host, req.destination_user,
                                  req.destination_port, req.ssh_key_path)
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
def update_replication_task(task_id: int, req: ReplicationUpdate, username: str = Depends(get_current_admin)):
    _validate_replication_fields(req.source_dataset, req.destination_dataset,
                                  req.destination_host, req.destination_user,
                                  req.destination_port, req.ssh_key_path)
    db = get_db()
    try:
        existing = db.execute("SELECT * FROM zfs_replication_tasks WHERE id = ?", (task_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Replication task not found")

        ALLOWED_FIELDS = {"name", "source_dataset", "destination_host", "destination_port",
                          "destination_user", "destination_dataset", "ssh_key_path", "schedule",
                          "recursive", "incremental", "enabled"}
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

        updates = {k: v for k, v in updates.items() if k in ALLOWED_FIELDS}
        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            db.execute(f"UPDATE zfs_replication_tasks SET {set_clause} WHERE id = ?", (*updates.values(), task_id))
            db.commit()
    finally:
        db.close()

    logger.info(f"User '{username}' updated replication task id={task_id}")
    return {"message": "Replication task updated"}


@router.delete("/{task_id}")
def delete_replication_task(task_id: int, username: str = Depends(get_current_admin)):
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
def run_replication_task(task_id: int, username: str = Depends(get_current_admin)):
    db = get_db()
    try:
        row = db.execute("SELECT * FROM zfs_replication_tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Replication task not found")
        task = dict(row)
    finally:
        db.close()

    # Validate fields before building shell command
    _validate_replication_fields(task["source_dataset"], task["destination_dataset"],
                                  task["destination_host"], task["destination_user"],
                                  task["destination_port"], task["ssh_key_path"])

    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    snap_name = f"{task['source_dataset']}@repl-{timestamp}"

    # Create snapshot (shlex.quote all user-supplied values)
    snap_cmd = "zfs snapshot"
    if task["recursive"]:
        snap_cmd += " -r"
    snap_cmd += f" {shlex.quote(snap_name)}"

    # Build send/receive pipe
    send_cmd = "zfs send"
    if task["recursive"]:
        send_cmd += " -R"
    if task["incremental"] and task["last_snapshot"]:
        send_cmd += f" -i {shlex.quote(task['last_snapshot'])}"
    send_cmd += f" {shlex.quote(snap_name)}"

    ssh_cmd = f"ssh -p {shlex.quote(str(task['destination_port']))}"
    if task["ssh_key_path"]:
        ssh_cmd += f" -i {shlex.quote(task['ssh_key_path'])}"
    user_host = task['destination_user'] + '@' + task['destination_host']
    ssh_cmd += f" {shlex.quote(user_host)}"

    recv_cmd = f"zfs receive -F {shlex.quote(task['destination_dataset'])}"

    full_cmd = f"{snap_cmd} && {send_cmd} | {ssh_cmd} {recv_cmd}"

    def on_complete(job_id, status, stdout, stderr, returncode):
        result_text = stdout or stderr or f"Exit code: {returncode}"
        success = status == "completed"
        db2 = get_db()
        try:
            if success:
                db2.execute(
                    "UPDATE zfs_replication_tasks SET last_run = ?, last_result = ?, last_snapshot = ? WHERE id = ?",
                    (datetime.now().isoformat(), result_text[:1000], snap_name, task_id),
                )
            else:
                db2.execute(
                    "UPDATE zfs_replication_tasks SET last_run = ?, last_result = ? WHERE id = ?",
                    (datetime.now().isoformat(), result_text[:1000], task_id),
                )
            db2.commit()
        finally:
            db2.close()
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

    from backend.utils.jobs import JobManager
    mgr = JobManager()
    try:
        job_id = mgr.submit(
            job_type="replication",
            description=f"Replication: {task['name']}",
            resource=f"replication:{task_id}",
            started_by=username,
            shell_cmd=full_cmd,
            timeout=7200,
            on_complete=on_complete,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    logger.info(f"User '{username}' ran replication task id={task_id} (job {job_id})")
    return {"job_id": job_id, "message": "Replication task started"}
