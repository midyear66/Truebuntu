import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.database import get_db
from backend.utils.auth import get_current_admin
from backend.utils.shell import run as shell_run

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/smart-tests", tags=["smart-tests"], dependencies=[Depends(get_current_admin)])

VALID_TEST_TYPES = {"short", "long", "conveyance", "offline"}


class SmartTestCreate(BaseModel):
    name: str
    disks: list[str] = []
    test_type: str = "short"
    schedule: str = "0 0 * * 0"
    enabled: bool = True


class SmartTestUpdate(BaseModel):
    name: str | None = None
    disks: list[str] | None = None
    test_type: str | None = None
    schedule: str | None = None
    enabled: bool | None = None


@router.get("")
def list_smart_tests():
    db = get_db()
    try:
        rows = db.execute("SELECT * FROM smart_tests ORDER BY id").fetchall()
        result = []
        for row in rows:
            t = dict(row)
            t["disks"] = json.loads(t["disks"])
            result.append(t)
        return result
    finally:
        db.close()


@router.get("/{test_id}")
def get_smart_test(test_id: int):
    db = get_db()
    try:
        row = db.execute("SELECT * FROM smart_tests WHERE id = ?", (test_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="SMART test not found")
        t = dict(row)
        t["disks"] = json.loads(t["disks"])
        return t
    finally:
        db.close()


@router.post("")
def create_smart_test(req: SmartTestCreate, username: str = Depends(get_current_admin)):
    if req.test_type not in VALID_TEST_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid test type: {req.test_type}")

    db = get_db()
    try:
        cursor = db.execute(
            """INSERT INTO smart_tests (name, disks, test_type, schedule, enabled)
               VALUES (?, ?, ?, ?, ?)""",
            (req.name, json.dumps(req.disks), req.test_type, req.schedule, int(req.enabled)),
        )
        db.commit()
        test_id = cursor.lastrowid
    finally:
        db.close()

    logger.info(f"User '{username}' created SMART test '{req.name}' (id={test_id})")
    return {"message": "SMART test created", "id": test_id}


@router.put("/{test_id}")
def update_smart_test(test_id: int, req: SmartTestUpdate, username: str = Depends(get_current_admin)):
    if req.test_type is not None and req.test_type not in VALID_TEST_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid test type: {req.test_type}")

    db = get_db()
    try:
        existing = db.execute("SELECT * FROM smart_tests WHERE id = ?", (test_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="SMART test not found")

        ALLOWED_FIELDS = {"name", "disks", "test_type", "schedule", "enabled"}
        updates = {}
        if req.name is not None:
            updates["name"] = req.name
        if req.disks is not None:
            updates["disks"] = json.dumps(req.disks)
        if req.test_type is not None:
            updates["test_type"] = req.test_type
        if req.schedule is not None:
            updates["schedule"] = req.schedule
        if req.enabled is not None:
            updates["enabled"] = int(req.enabled)

        updates = {k: v for k, v in updates.items() if k in ALLOWED_FIELDS}
        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            db.execute(f"UPDATE smart_tests SET {set_clause} WHERE id = ?", (*updates.values(), test_id))
            db.commit()
    finally:
        db.close()

    logger.info(f"User '{username}' updated SMART test id={test_id}")
    return {"message": "SMART test updated"}


@router.delete("/{test_id}")
def delete_smart_test(test_id: int, username: str = Depends(get_current_admin)):
    db = get_db()
    try:
        result = db.execute("DELETE FROM smart_tests WHERE id = ?", (test_id,))
        db.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="SMART test not found")
    finally:
        db.close()

    logger.info(f"User '{username}' deleted SMART test id={test_id}")
    return {"message": "SMART test deleted"}


@router.post("/{test_id}/run")
def run_smart_test(test_id: int, username: str = Depends(get_current_admin)):
    db = get_db()
    try:
        row = db.execute("SELECT * FROM smart_tests WHERE id = ?", (test_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="SMART test not found")
        test = dict(row)
        test["disks"] = json.loads(test["disks"])
    finally:
        db.close()

    if not test["disks"]:
        raise HTTPException(status_code=400, detail="No disks configured for this test")

    # Build a shell command that runs smartctl on each disk chained with &&
    cmds = [f"smartctl -t {test['test_type']} /dev/{disk}" for disk in test["disks"]]
    shell_cmd = " && ".join(cmds)

    def on_complete(job_id, status, stdout, stderr, returncode):
        result_text = stdout or stderr or f"Exit code: {returncode}"
        db2 = get_db()
        try:
            db2.execute(
                "UPDATE smart_tests SET last_run = ?, last_result = ? WHERE id = ?",
                (datetime.now().isoformat(), result_text[:1000], test_id),
            )
            db2.commit()
        finally:
            db2.close()
        if "FAILED" in result_text.upper() or "error" in result_text.lower():
            try:
                from backend.utils.email import send_alert
                send_alert("smart_failures",
                           f"SMART test issue: {test['name']}",
                           f"Test: {test['name']}\nDisks: {', '.join(test['disks'])}\nResult: {result_text[:500]}")
            except Exception:
                pass

    from backend.utils.jobs import JobManager
    mgr = JobManager()
    try:
        job_id = mgr.submit(
            job_type="smart_test",
            description=f"SMART {test['test_type']} test: {test['name']}",
            resource=f"smart_test:{test_id}",
            started_by=username,
            shell_cmd=shell_cmd,
            timeout=60,
            on_complete=on_complete,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    logger.info(f"User '{username}' ran SMART test id={test_id} (job {job_id})")
    return {"job_id": job_id, "message": "SMART test started"}
