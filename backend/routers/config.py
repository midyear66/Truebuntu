import io
import json
import logging
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse

from backend.database import DATABASE_PATH, get_db
from backend.utils.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/config", tags=["config"], dependencies=[Depends(get_current_user)])


@router.get("/export")
def export_config(username: str = Depends(get_current_user)):
    db = get_db()
    try:
        export = {
            "version": 1,
            "exported_at": datetime.now().isoformat(),
            "exported_by": username,
        }

        # Export snapshot policies
        rows = db.execute("SELECT * FROM snapshot_policies").fetchall()
        export["snapshot_policies"] = [dict(r) for r in rows]

        # Export tasks
        rows = db.execute("SELECT * FROM tasks").fetchall()
        tasks = []
        for r in rows:
            t = dict(r)
            t["config"] = json.loads(t["config"])
            tasks.append(t)
        export["tasks"] = tasks

        # Export settings
        rows = db.execute("SELECT * FROM settings").fetchall()
        export["settings"] = {r["key"]: r["value"] for r in rows}

        # Export smb.conf
        smb_path = Path("/etc/samba/smb.conf")
        if smb_path.exists():
            export["smb_conf"] = smb_path.read_text()

        # Export /etc/exports
        exports_path = Path("/etc/exports")
        if exports_path.exists():
            export["exports"] = exports_path.read_text()

    finally:
        db.close()

    content = json.dumps(export, indent=2)
    logger.info(f"User '{username}' exported config")
    return StreamingResponse(
        io.BytesIO(content.encode()),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename=nas-config-{datetime.now().strftime('%Y%m%d')}.json"},
    )


@router.post("/import")
async def import_config(file: UploadFile = File(...), username: str = Depends(get_current_user)):
    content = await file.read()
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON file")

    if data.get("version") != 1:
        raise HTTPException(status_code=400, detail="Unsupported config version")

    results = {}
    db = get_db()
    try:
        # Import snapshot policies
        if "snapshot_policies" in data:
            for policy in data["snapshot_policies"]:
                db.execute(
                    """INSERT INTO snapshot_policies
                       (name, dataset, recursive, schedule, retention_count, retention_unit,
                        naming_schema, exclude, enabled)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        policy["name"], policy["dataset"],
                        policy.get("recursive", 0), policy["schedule"],
                        policy.get("retention_count", 10), policy.get("retention_unit", "count"),
                        policy.get("naming_schema", "auto-%Y-%m-%d_%H-%M"),
                        policy.get("exclude", "[]"), policy.get("enabled", 1),
                    ),
                )
            results["snapshot_policies"] = len(data["snapshot_policies"])

        # Import tasks
        if "tasks" in data:
            for task in data["tasks"]:
                db.execute(
                    "INSERT INTO tasks (name, type, schedule, config, enabled) VALUES (?, ?, ?, ?, ?)",
                    (
                        task["name"], task["type"], task.get("schedule"),
                        json.dumps(task.get("config", {})), task.get("enabled", 1),
                    ),
                )
            results["tasks"] = len(data["tasks"])

        # Import settings
        if "settings" in data:
            for key, value in data["settings"].items():
                db.execute(
                    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                    (key, value),
                )
            results["settings"] = len(data["settings"])

        db.commit()

        # Import smb.conf
        if "smb_conf" in data:
            Path("/etc/samba/smb.conf").write_text(data["smb_conf"])
            results["smb_conf"] = True

        # Import /etc/exports
        if "exports" in data:
            Path("/etc/exports").write_text(data["exports"])
            results["exports"] = True

    finally:
        db.close()

    logger.info(f"User '{username}' imported config: {results}")
    return {"message": "Config imported", "imported": results}


@router.get("/audit-log")
def get_audit_log(limit: int = 100):
    db = get_db()
    try:
        rows = db.execute(
            "SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        db.close()
