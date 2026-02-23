import io
import json
import logging
import sqlite3
import tarfile
import tempfile

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel

from backend.database import get_db
from backend.utils.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/migrate", tags=["migrate"], dependencies=[Depends(get_current_user)])


class ApplyMigrationRequest(BaseModel):
    users: bool = True
    smb_shares: bool = True
    nfs_exports: bool = True
    snapshot_policies: bool = True
    tasks: bool = True


@router.post("/truenas")
async def preview_truenas_config(file: UploadFile = File(...), username: str = Depends(get_current_user)):
    if not file.filename.endswith(".tar"):
        raise HTTPException(status_code=400, detail="Expected a .tar file")

    content = await file.read()
    try:
        parsed = _parse_truenas_tar(content)
    except Exception as e:
        logger.exception("Failed to parse TrueNAS config")
        raise HTTPException(status_code=400, detail=f"Failed to parse config: {e}")

    logger.info(f"User '{username}' uploaded TrueNAS config for preview")
    return parsed


@router.post("/truenas/apply")
async def apply_truenas_config(
    file: UploadFile = File(...),
    username: str = Depends(get_current_user),
):
    content = await file.read()
    try:
        parsed = _parse_truenas_tar(content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse config: {e}")

    results = {}

    # Import snapshot policies
    if parsed.get("snapshot_policies"):
        db = get_db()
        try:
            count = 0
            for policy in parsed["snapshot_policies"]:
                db.execute(
                    """INSERT INTO snapshot_policies
                       (name, dataset, recursive, schedule, retention_count, retention_unit,
                        naming_schema, exclude, enabled)
                       VALUES (?, ?, ?, ?, ?, 'count', 'auto-%Y-%m-%d_%H-%M', '[]', 1)""",
                    (
                        policy.get("name", "imported"),
                        policy.get("dataset", ""),
                        1 if policy.get("recursive") else 0,
                        policy.get("schedule", "0 * * * *"),
                        policy.get("retention", 10),
                    ),
                )
                count += 1
            db.commit()
            results["snapshot_policies"] = count
        finally:
            db.close()

    # Import tasks (scrub schedules)
    if parsed.get("scrub_tasks"):
        db = get_db()
        try:
            count = 0
            for task in parsed["scrub_tasks"]:
                db.execute(
                    "INSERT INTO tasks (name, type, schedule, config, enabled) VALUES (?, ?, ?, ?, 1)",
                    (
                        f"Scrub {task.get('pool', 'unknown')}",
                        "scrub",
                        task.get("schedule", "0 0 * * 0"),
                        json.dumps({"pool": task.get("pool", "")}),
                    ),
                )
                count += 1
            db.commit()
            results["scrub_tasks"] = count
        finally:
            db.close()

    # Import cloud sync tasks (credentials must be re-entered)
    if parsed.get("cloud_sync_tasks"):
        db = get_db()
        try:
            count = 0
            for task in parsed["cloud_sync_tasks"]:
                db.execute(
                    "INSERT INTO tasks (name, type, schedule, config, enabled) VALUES (?, ?, ?, ?, 1)",
                    (
                        task.get("description", "Cloud Sync"),
                        "rclone_sync",
                        task.get("schedule", ""),
                        json.dumps({
                            "source": task.get("path", ""),
                            "dest": task.get("dest", ""),
                            "note": "Credentials must be re-entered",
                        }),
                    ),
                )
                count += 1
            db.commit()
            results["cloud_sync_tasks"] = count
        finally:
            db.close()

    logger.info(f"User '{username}' applied TrueNAS migration: {results}")
    return {"message": "Migration applied", "imported": results}


def _parse_truenas_tar(tar_bytes: bytes) -> dict:
    parsed = {
        "users": [],
        "smb_shares": [],
        "nfs_exports": [],
        "snapshot_policies": [],
        "scrub_tasks": [],
        "cloud_sync_tasks": [],
        "services": [],
    }

    with tempfile.NamedTemporaryFile(suffix=".tar") as tmp:
        tmp.write(tar_bytes)
        tmp.flush()

        with tarfile.open(tmp.name, "r:*") as tar:
            db_member = None
            for member in tar.getmembers():
                if member.name.endswith(".db"):
                    db_member = member
                    break

            if not db_member:
                raise ValueError("No SQLite database found in tar archive")

            db_file = tar.extractfile(db_member)
            if not db_file:
                raise ValueError("Could not extract database file")

            db_bytes = db_file.read()

    with tempfile.NamedTemporaryFile(suffix=".db") as tmp_db:
        tmp_db.write(db_bytes)
        tmp_db.flush()

        conn = sqlite3.connect(tmp_db.name)
        conn.row_factory = sqlite3.Row

        try:
            # Users
            try:
                rows = conn.execute(
                    "SELECT bsdusr_username, bsdusr_uid, bsdusr_group_id FROM account_bsdusers"
                ).fetchall()
                for row in rows:
                    parsed["users"].append({
                        "username": row["bsdusr_username"],
                        "uid": row["bsdusr_uid"],
                        "gid": row["bsdusr_group_id"],
                    })
            except sqlite3.OperationalError:
                pass

            # SMB shares
            try:
                rows = conn.execute(
                    "SELECT cifs_name, cifs_path, cifs_comment FROM sharing_cifs_share"
                ).fetchall()
                for row in rows:
                    parsed["smb_shares"].append({
                        "name": row["cifs_name"],
                        "path": row["cifs_path"],
                        "comment": row["cifs_comment"] or "",
                    })
            except sqlite3.OperationalError:
                pass

            # NFS exports
            try:
                rows = conn.execute(
                    "SELECT id, nfs_paths, nfs_hosts, nfs_maproot_user, nfs_maproot_group, nfs_security FROM sharing_nfs_share"
                ).fetchall()
                for row in rows:
                    paths = row["nfs_paths"] if row["nfs_paths"] else ""
                    hosts = row["nfs_hosts"] if row["nfs_hosts"] else ""
                    parsed["nfs_exports"].append({
                        "id": row["id"],
                        "paths": paths,
                        "hosts": hosts,
                        "maproot_user": row["nfs_maproot_user"] or "",
                        "maproot_group": row["nfs_maproot_group"] or "",
                    })
            except sqlite3.OperationalError:
                pass

            # Snapshot policies
            try:
                rows = conn.execute(
                    "SELECT * FROM storage_task WHERE task_type = 'snapshot'"
                ).fetchall()
                for row in rows:
                    r = dict(row)
                    parsed["snapshot_policies"].append({
                        "name": f"Imported policy {r.get('id', '')}",
                        "dataset": r.get("task_dataset", r.get("task_filesystem", "")),
                        "recursive": bool(r.get("task_recursive", 0)),
                        "retention": r.get("task_ret_count", 10),
                        "schedule": _parse_truenas_schedule(r),
                    })
            except sqlite3.OperationalError:
                pass

            # Scrub tasks
            try:
                rows = conn.execute("SELECT * FROM storage_scrub").fetchall()
                for row in rows:
                    r = dict(row)
                    pool_id = r.get("scrub_volume_id", "")
                    pool_name = str(pool_id)
                    try:
                        vol = conn.execute(
                            "SELECT vol_name FROM storage_volume WHERE id = ?", (pool_id,)
                        ).fetchone()
                        if vol:
                            pool_name = vol["vol_name"]
                    except sqlite3.OperationalError:
                        pass
                    parsed["scrub_tasks"].append({
                        "pool": pool_name,
                        "schedule": _parse_truenas_schedule(r, prefix="scrub_"),
                    })
            except sqlite3.OperationalError:
                pass

            # Cloud sync tasks
            try:
                rows = conn.execute("SELECT * FROM tasks_cloudsync").fetchall()
                for row in rows:
                    r = dict(row)
                    parsed["cloud_sync_tasks"].append({
                        "description": r.get("description", ""),
                        "path": r.get("path", ""),
                        "direction": r.get("direction", ""),
                        "schedule": _parse_truenas_schedule(r, prefix=""),
                    })
            except sqlite3.OperationalError:
                pass

        finally:
            conn.close()

    return parsed


def _parse_truenas_schedule(row, prefix="task_") -> str:
    try:
        minute = row.get(f"{prefix}minute", row.get("minute", "*"))
        hour = row.get(f"{prefix}hour", row.get("hour", "*"))
        dom = row.get(f"{prefix}daymonth", row.get("daymonth", "*"))
        month = row.get(f"{prefix}month", row.get("month", "*"))
        dow = row.get(f"{prefix}dayweek", row.get("dayweek", "*"))
        return f"{minute} {hour} {dom} {month} {dow}"
    except Exception:
        return "0 * * * *"
