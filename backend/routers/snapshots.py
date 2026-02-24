import json
import logging
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.database import get_db
from backend.utils.auth import get_current_user, get_current_admin
from backend.utils.shell import run
from backend.utils.zfs import list_snapshots

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/snapshots", tags=["snapshots"], dependencies=[Depends(get_current_user)])

VALID_NAME = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_./@-]*$")


class SnapshotCreateRequest(BaseModel):
    dataset: str
    name: str | None = None
    recursive: bool = False


class SnapshotPolicyCreate(BaseModel):
    name: str
    dataset: str
    recursive: bool = False
    schedule: str
    retention_count: int = 10
    retention_unit: str = "count"
    naming_schema: str = "auto-%Y-%m-%d_%H-%M"
    exclude: list[str] = []
    enabled: bool = True


class SnapshotPolicyUpdate(BaseModel):
    name: str | None = None
    dataset: str | None = None
    recursive: bool | None = None
    schedule: str | None = None
    retention_count: int | None = None
    retention_unit: str | None = None
    naming_schema: str | None = None
    exclude: list[str] | None = None
    enabled: bool | None = None


@router.get("")
def get_snapshots(dataset: str | None = None):
    return list_snapshots(dataset)


@router.post("")
def create_snapshot(req: SnapshotCreateRequest, username: str = Depends(get_current_admin)):
    if not VALID_NAME.match(req.dataset):
        raise HTTPException(status_code=400, detail="Invalid dataset name")

    snap_name = req.name or datetime.now().strftime("manual-%Y-%m-%d_%H-%M-%S")
    full_name = f"{req.dataset}@{snap_name}"

    cmd = ["zfs", "snapshot"]
    if req.recursive:
        cmd.append("-r")
    cmd.append(full_name)

    result = run(cmd)
    if not result.ok:
        raise HTTPException(status_code=500, detail=result.stderr.strip())

    logger.info(f"User '{username}' created snapshot '{full_name}'")
    return {"message": f"Snapshot '{full_name}' created", "name": full_name}


@router.delete("/{snapshot:path}")
def delete_snapshot(snapshot: str, username: str = Depends(get_current_admin)):
    if not VALID_NAME.match(snapshot) or "@" not in snapshot:
        raise HTTPException(status_code=400, detail="Invalid snapshot name")

    result = run(["zfs", "destroy", snapshot])
    if not result.ok:
        raise HTTPException(status_code=500, detail=result.stderr.strip())

    logger.info(f"User '{username}' destroyed snapshot '{snapshot}'")
    return {"message": f"Snapshot '{snapshot}' destroyed"}


@router.post("/{snapshot:path}/rollback")
def rollback_snapshot(snapshot: str, username: str = Depends(get_current_admin)):
    if not VALID_NAME.match(snapshot) or "@" not in snapshot:
        raise HTTPException(status_code=400, detail="Invalid snapshot name")

    dataset = snapshot.split("@")[0]
    from backend.utils.jobs import JobManager
    mgr = JobManager()
    try:
        job_id = mgr.submit(
            job_type="rollback",
            description=f"Rollback to '{snapshot}'",
            resource=f"rollback:{dataset}",
            started_by=username,
            cmd=["zfs", "rollback", "-r", snapshot],
            timeout=120,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    logger.info(f"User '{username}' started rollback to snapshot '{snapshot}' (job {job_id})")
    return {"job_id": job_id, "message": f"Rollback to '{snapshot}' started"}


@router.post("/{snapshot:path}/clone")
def clone_snapshot(snapshot: str, target: str = "", username: str = Depends(get_current_admin)):
    if not VALID_NAME.match(snapshot) or "@" not in snapshot:
        raise HTTPException(status_code=400, detail="Invalid snapshot name")
    if not target or not VALID_NAME.match(target):
        raise HTTPException(status_code=400, detail="Invalid target dataset name")

    result = run(["zfs", "clone", snapshot, target])
    if not result.ok:
        raise HTTPException(status_code=500, detail=result.stderr.strip())

    logger.info(f"User '{username}' cloned snapshot '{snapshot}' to '{target}'")
    return {"message": f"Cloned '{snapshot}' to '{target}'"}


# --- Snapshot Policies ---

policies_router = APIRouter(
    prefix="/snapshot-policies", tags=["snapshot-policies"],
    dependencies=[Depends(get_current_user)],
)


@policies_router.get("")
def list_policies():
    db = get_db()
    try:
        rows = db.execute("SELECT * FROM snapshot_policies ORDER BY id").fetchall()
        return [dict(row) for row in rows]
    finally:
        db.close()


@policies_router.get("/{policy_id}")
def get_policy(policy_id: int):
    db = get_db()
    try:
        row = db.execute("SELECT * FROM snapshot_policies WHERE id = ?", (policy_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Policy not found")
        return dict(row)
    finally:
        db.close()


@policies_router.post("")
def create_policy(req: SnapshotPolicyCreate, username: str = Depends(get_current_admin)):
    db = get_db()
    try:
        cursor = db.execute(
            """INSERT INTO snapshot_policies
               (name, dataset, recursive, schedule, retention_count, retention_unit,
                naming_schema, exclude, enabled)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                req.name, req.dataset, int(req.recursive), req.schedule,
                req.retention_count, req.retention_unit, req.naming_schema,
                json.dumps(req.exclude), int(req.enabled),
            ),
        )
        db.commit()
        policy_id = cursor.lastrowid
    finally:
        db.close()

    logger.info(f"User '{username}' created snapshot policy '{req.name}' (id={policy_id})")
    return {"message": "Policy created", "id": policy_id}


@policies_router.put("/{policy_id}")
def update_policy(policy_id: int, req: SnapshotPolicyUpdate, username: str = Depends(get_current_admin)):
    db = get_db()
    try:
        existing = db.execute("SELECT * FROM snapshot_policies WHERE id = ?", (policy_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Policy not found")

        ALLOWED_FIELDS = {"name", "dataset", "schedule", "retention_count", "retention_unit",
                          "naming_schema", "enabled", "recursive", "exclude"}
        updates = {}
        for field in ["name", "dataset", "schedule", "retention_count", "retention_unit", "naming_schema", "enabled"]:
            val = getattr(req, field, None)
            if val is not None:
                updates[field] = int(val) if isinstance(val, bool) else val
        if req.recursive is not None:
            updates["recursive"] = int(req.recursive)
        if req.exclude is not None:
            updates["exclude"] = json.dumps(req.exclude)

        updates = {k: v for k, v in updates.items() if k in ALLOWED_FIELDS}
        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            db.execute(
                f"UPDATE snapshot_policies SET {set_clause} WHERE id = ?",
                (*updates.values(), policy_id),
            )
            db.commit()
    finally:
        db.close()

    logger.info(f"User '{username}' updated snapshot policy id={policy_id}")
    return {"message": "Policy updated"}


@policies_router.delete("/{policy_id}")
def delete_policy(policy_id: int, username: str = Depends(get_current_admin)):
    db = get_db()
    try:
        result = db.execute("DELETE FROM snapshot_policies WHERE id = ?", (policy_id,))
        db.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Policy not found")
    finally:
        db.close()

    logger.info(f"User '{username}' deleted snapshot policy id={policy_id}")
    return {"message": "Policy deleted"}
