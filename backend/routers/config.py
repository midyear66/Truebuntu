import io
import json
import logging
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

import yaml
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse

from backend.database import DATABASE_PATH, get_db
from backend.utils.auth import get_current_user
from backend.utils.shell import run

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/config", tags=["config"], dependencies=[Depends(get_current_user)])


@router.get("/export")
def export_config(username: str = Depends(get_current_user)):
    db = get_db()
    try:
        export = {
            "version": 3,
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

        # Export cron jobs
        rows = db.execute("SELECT * FROM cron_jobs").fetchall()
        export["cron_jobs"] = [dict(r) for r in rows]

        # Export init/shutdown scripts
        rows = db.execute("SELECT * FROM init_shutdown_scripts").fetchall()
        export["init_shutdown_scripts"] = [dict(r) for r in rows]

        # Export rsync tasks
        rows = db.execute("SELECT * FROM rsync_tasks").fetchall()
        export["rsync_tasks"] = [dict(r) for r in rows]

        # Export SMART tests
        rows = db.execute("SELECT * FROM smart_tests").fetchall()
        export["smart_tests"] = [dict(r) for r in rows]

        # Export replication tasks
        rows = db.execute("SELECT * FROM zfs_replication_tasks").fetchall()
        export["zfs_replication_tasks"] = [dict(r) for r in rows]

        # Export resilver config
        row = db.execute("SELECT * FROM resilver_config WHERE id = 1").fetchone()
        if row:
            export["resilver_config"] = dict(row)

        # Export smb.conf
        smb_path = Path("/etc/samba/smb.conf")
        if smb_path.exists():
            export["smb_conf"] = smb_path.read_text()

        # Export /etc/exports
        exports_path = Path("/etc/exports")
        if exports_path.exists():
            export["exports"] = exports_path.read_text()

        # Export netplan configs
        netplan_dir = Path("/etc/netplan")
        if netplan_dir.is_dir():
            netplan = {}
            for f in sorted(netplan_dir.glob("*.yaml")):
                try:
                    netplan[f.name] = yaml.safe_load(f.read_text())
                except Exception:
                    pass
            if netplan:
                export["netplan"] = netplan

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

    if data.get("version") not in (1, 2, 3):
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

        # Import cron jobs
        if "cron_jobs" in data:
            for job in data["cron_jobs"]:
                db.execute(
                    """INSERT INTO cron_jobs (name, command, schedule, user, description, enabled)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (job["name"], job["command"], job.get("schedule", "0 * * * *"),
                     job.get("user", "root"), job.get("description", ""), job.get("enabled", 1)),
                )
            results["cron_jobs"] = len(data["cron_jobs"])

        # Import init/shutdown scripts
        if "init_shutdown_scripts" in data:
            for s in data["init_shutdown_scripts"]:
                db.execute(
                    """INSERT INTO init_shutdown_scripts (name, type, when_run, command, timeout, enabled)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (s["name"], s.get("type", "init"), s.get("when_run", "post"),
                     s["command"], s.get("timeout", 30), s.get("enabled", 1)),
                )
            results["init_shutdown_scripts"] = len(data["init_shutdown_scripts"])

        # Import rsync tasks
        if "rsync_tasks" in data:
            for t in data["rsync_tasks"]:
                db.execute(
                    """INSERT INTO rsync_tasks
                       (name, source, destination, direction, mode, remote_host, remote_port,
                        remote_user, remote_path, schedule, extra_args, recursive, archive,
                        compress, delete_dest, enabled)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (t["name"], t["source"], t["destination"], t.get("direction", "push"),
                     t.get("mode", "ssh"), t.get("remote_host", ""), t.get("remote_port", 22),
                     t.get("remote_user", "root"), t.get("remote_path", ""),
                     t.get("schedule", "0 0 * * *"), t.get("extra_args", ""),
                     t.get("recursive", 1), t.get("archive", 1), t.get("compress", 1),
                     t.get("delete_dest", 0), t.get("enabled", 1)),
                )
            results["rsync_tasks"] = len(data["rsync_tasks"])

        # Import SMART tests
        if "smart_tests" in data:
            for t in data["smart_tests"]:
                disks = t.get("disks", "[]")
                if isinstance(disks, list):
                    disks = json.dumps(disks)
                db.execute(
                    """INSERT INTO smart_tests (name, disks, test_type, schedule, enabled)
                       VALUES (?, ?, ?, ?, ?)""",
                    (t["name"], disks, t.get("test_type", "short"),
                     t.get("schedule", "0 0 * * 0"), t.get("enabled", 1)),
                )
            results["smart_tests"] = len(data["smart_tests"])

        # Import replication tasks
        if "zfs_replication_tasks" in data:
            for t in data["zfs_replication_tasks"]:
                db.execute(
                    """INSERT INTO zfs_replication_tasks
                       (name, source_dataset, destination_host, destination_port, destination_user,
                        destination_dataset, recursive, incremental, ssh_key_path, schedule, enabled)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (t["name"], t["source_dataset"], t["destination_host"],
                     t.get("destination_port", 22), t.get("destination_user", "root"),
                     t["destination_dataset"], t.get("recursive", 0), t.get("incremental", 1),
                     t.get("ssh_key_path", ""), t.get("schedule", "0 0 * * *"),
                     t.get("enabled", 1)),
                )
            results["zfs_replication_tasks"] = len(data["zfs_replication_tasks"])

        # Import resilver config
        if "resilver_config" in data:
            rc = data["resilver_config"]
            weekdays = rc.get("weekdays", "[1,2,3,4,5,6,7]")
            if isinstance(weekdays, list):
                weekdays = json.dumps(weekdays)
            db.execute(
                """UPDATE resilver_config SET enabled = ?, begin_hour = ?, begin_minute = ?,
                   end_hour = ?, end_minute = ?, weekdays = ? WHERE id = 1""",
                (rc.get("enabled", 0), rc.get("begin_hour", 18), rc.get("begin_minute", 0),
                 rc.get("end_hour", 6), rc.get("end_minute", 0), weekdays),
            )
            results["resilver_config"] = True

        db.commit()

        # Import smb.conf
        if "smb_conf" in data:
            Path("/etc/samba/smb.conf").write_text(data["smb_conf"])
            results["smb_conf"] = True

        # Import /etc/exports
        if "exports" in data:
            Path("/etc/exports").write_text(data["exports"])
            results["exports"] = True

        # Import netplan configs
        if "netplan" in data:
            netplan_dir = Path("/etc/netplan")
            netplan_dir.mkdir(parents=True, exist_ok=True)
            for filename, content in data["netplan"].items():
                if not filename.endswith(".yaml"):
                    continue
                (netplan_dir / filename).write_text(yaml.dump(content, default_flow_style=False, sort_keys=False))
            run(["nsenter", "-t", "1", "-m", "-u", "-n", "-i", "netplan", "apply"], timeout=30)
            results["netplan"] = len(data["netplan"])

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
