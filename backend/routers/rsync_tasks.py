import logging
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.database import get_db
from backend.utils.auth import get_current_admin
from backend.utils.shell import run as shell_run

logger = logging.getLogger(__name__)

VALID_HOSTNAME = re.compile(r"^[a-zA-Z0-9._-]+$")
VALID_RSYNC_USERNAME = re.compile(r"^[a-zA-Z0-9._-]+$")
VALID_PATH = re.compile(r"^[a-zA-Z0-9_./ -]+$")

# Whitelist of safe rsync flags (flags and their --long forms)
SAFE_RSYNC_FLAGS = {
    "--progress", "--verbose", "-v", "--stats", "--human-readable", "-h",
    "--partial", "--bwlimit", "--timeout", "--checksum", "-c",
    "--exclude", "--include", "--itemize-changes", "-i",
    "--dry-run", "-n", "--no-perms", "--no-owner", "--no-group",
    "--update", "-u", "--inplace", "--append", "--append-verify",
}
# Flags that can execute arbitrary commands
RSYNC_DANGEROUS_FLAGS = {"--rsh", "-e", "--rsync-path", "--daemon", "--config"}


def _validate_rsync_extra_args(extra_args: str):
    """Validate that extra_args only contains safe rsync flags."""
    if not extra_args:
        return
    for arg in extra_args.split():
        # Split --flag=value on '='
        flag = arg.split("=", 1)[0]
        # Check against dangerous flags
        if flag in RSYNC_DANGEROUS_FLAGS:
            raise HTTPException(status_code=400, detail=f"Dangerous rsync flag not allowed: {flag}")
        # Single-char flags like -v, -n are fine; multi-char must be in whitelist
        if flag.startswith("--") and flag not in SAFE_RSYNC_FLAGS:
            raise HTTPException(status_code=400, detail=f"Rsync flag not allowed: {flag}")


def _validate_rsync_fields(remote_host: str | None, remote_user: str | None,
                            remote_port: int | None, remote_path: str | None,
                            source: str | None, destination: str | None,
                            extra_args: str | None):
    if remote_host is not None and remote_host and not VALID_HOSTNAME.match(remote_host):
        raise HTTPException(status_code=400, detail="Invalid remote hostname")
    if remote_user is not None and remote_user and not VALID_RSYNC_USERNAME.match(remote_user):
        raise HTTPException(status_code=400, detail="Invalid remote username")
    if remote_port is not None and not (1 <= remote_port <= 65535):
        raise HTTPException(status_code=400, detail="Port must be between 1 and 65535")
    if remote_path is not None and remote_path and not VALID_PATH.match(remote_path):
        raise HTTPException(status_code=400, detail="Invalid remote path")
    if source is not None and source and not VALID_PATH.match(source):
        raise HTTPException(status_code=400, detail="Invalid source path")
    if destination is not None and destination and not VALID_PATH.match(destination):
        raise HTTPException(status_code=400, detail="Invalid destination path")
    if extra_args is not None:
        _validate_rsync_extra_args(extra_args)
router = APIRouter(prefix="/rsync-tasks", tags=["rsync-tasks"], dependencies=[Depends(get_current_admin)])


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
def create_rsync_task(req: RsyncTaskCreate, username: str = Depends(get_current_admin)):
    _validate_rsync_fields(req.remote_host, req.remote_user, req.remote_port,
                            req.remote_path, req.source, req.destination, req.extra_args)
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
def update_rsync_task(task_id: int, req: RsyncTaskUpdate, username: str = Depends(get_current_admin)):
    _validate_rsync_fields(req.remote_host, req.remote_user, req.remote_port,
                            req.remote_path, req.source, req.destination, req.extra_args)
    db = get_db()
    try:
        existing = db.execute("SELECT * FROM rsync_tasks WHERE id = ?", (task_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Rsync task not found")

        ALLOWED_FIELDS = {"name", "source", "destination", "direction", "mode",
                          "remote_host", "remote_port", "remote_user", "remote_path",
                          "schedule", "extra_args", "recursive", "archive", "compress",
                          "delete_dest", "enabled"}
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

        updates = {k: v for k, v in updates.items() if k in ALLOWED_FIELDS}
        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            db.execute(f"UPDATE rsync_tasks SET {set_clause} WHERE id = ?", (*updates.values(), task_id))
            db.commit()
    finally:
        db.close()

    logger.info(f"User '{username}' updated rsync task id={task_id}")
    return {"message": "Rsync task updated"}


@router.delete("/{task_id}")
def delete_rsync_task(task_id: int, username: str = Depends(get_current_admin)):
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
def run_rsync_task(task_id: int, username: str = Depends(get_current_admin)):
    db = get_db()
    try:
        row = db.execute("SELECT * FROM rsync_tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Rsync task not found")
        task = dict(row)
    finally:
        db.close()

    # Validate fields before building command
    _validate_rsync_fields(task["remote_host"], task["remote_user"], task["remote_port"],
                            task["remote_path"], task["source"], task["destination"],
                            task["extra_args"])

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
        # Already validated above; split and append safe args
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

    def on_complete(job_id, status, stdout, stderr, returncode):
        result_text = stdout or stderr or f"Exit code: {returncode}"
        db2 = get_db()
        try:
            db2.execute(
                "UPDATE rsync_tasks SET last_run = ?, last_result = ? WHERE id = ?",
                (datetime.now().isoformat(), result_text[:1000], task_id),
            )
            db2.commit()
        finally:
            db2.close()
        if status == "failed":
            try:
                from backend.utils.email import send_alert
                send_alert("rsync_failures",
                           f"Rsync task failed: {task['name']}",
                           f"Task: {task['name']}\nSource: {task['source']}\nDest: {task['destination']}\nResult: {result_text[:500]}")
            except Exception:
                pass

    from backend.utils.jobs import JobManager
    mgr = JobManager()
    try:
        job_id = mgr.submit(
            job_type="rsync",
            description=f"Rsync: {task['name']}",
            resource=f"rsync:{task_id}",
            started_by=username,
            cmd=args,
            timeout=3600,
            on_complete=on_complete,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    logger.info(f"User '{username}' ran rsync task id={task_id} (job {job_id})")
    return {"job_id": job_id, "message": "Rsync task started"}
