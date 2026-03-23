import json
import logging
import threading
import time
from datetime import datetime

from croniter import croniter

from backend.database import get_db
from backend.utils.shell import run

logger = logging.getLogger(__name__)

POLL_INTERVAL = 30  # seconds between schedule checks


def _should_run(schedule: str, last_run: str | None) -> bool:
    """Check if a policy is due based on its cron schedule and last run time."""
    now = datetime.now()
    if last_run:
        last = datetime.fromisoformat(last_run)
    else:
        # Never run before — treat as long overdue
        last = datetime(2000, 1, 1)

    cron = croniter(schedule, last)
    next_run = cron.get_next(datetime)
    return next_run <= now


def _run_policy(policy: dict):
    """Execute a single snapshot policy."""
    dataset = policy["dataset"]
    naming = policy.get("naming_schema") or "auto-%Y-%m-%d_%H-%M"
    snap_name = datetime.now().strftime(naming)
    full_name = f"{dataset}@{snap_name}"

    cmd = ["zfs", "snapshot"]
    if policy.get("recursive"):
        cmd.append("-r")
    cmd.append(full_name)

    logger.info(f"Snapshot policy '{policy['name']}' (id={policy['id']}): creating {full_name}")
    result = run(cmd)

    if result.ok:
        logger.info(f"Snapshot policy '{policy['name']}': created {full_name}")
    else:
        logger.error(f"Snapshot policy '{policy['name']}': failed — {result.stderr.strip()}")

    # Update last_run regardless of success (avoid retrying every 30s on persistent errors)
    db = get_db()
    try:
        db.execute(
            "UPDATE snapshot_policies SET last_run = ? WHERE id = ?",
            (datetime.now().isoformat(), policy["id"]),
        )
        db.commit()
    finally:
        db.close()

    # Retention cleanup
    if result.ok:
        _enforce_retention(policy)


def _enforce_retention(policy: dict):
    """Delete old snapshots beyond the retention limit."""
    dataset = policy["dataset"]
    naming = policy.get("naming_schema") or "auto-%Y-%m-%d_%H-%M"
    # Extract the prefix before any strftime token
    prefix = naming.split("%")[0] if "%" in naming else naming

    # Use -p for parseable (unix timestamp) creation times, sorted oldest first
    result = run(["zfs", "list", "-H", "-t", "snapshot", "-p", "-o", "name,creation",
                  "-s", "creation", "-r", dataset])
    if not result.ok:
        return

    policy_snaps = []
    for line in result.stdout.strip().splitlines():
        parts = line.split("\t")
        if len(parts) >= 2:
            name = parts[0]
            # Filter to snapshots matching this policy's naming prefix
            snap_part = name.rsplit("@", 1)[1] if "@" in name else ""
            if snap_part.startswith(prefix):
                try:
                    creation_ts = int(parts[1])
                except (ValueError, TypeError):
                    creation_ts = 0
                policy_snaps.append({"name": name, "creation_ts": creation_ts})

    retention_count = policy.get("retention_count", 10)
    retention_unit = policy.get("retention_unit", "count")

    to_delete = []
    if retention_unit == "count":
        if len(policy_snaps) > retention_count:
            to_delete = policy_snaps[:len(policy_snaps) - retention_count]
    else:
        # Time-based retention
        now_ts = time.time()
        unit_seconds = {
            "hour": 3600,
            "day": 86400,
            "week": 604800,
            "month": 2592000,
        }
        max_age = retention_count * unit_seconds.get(retention_unit, 86400)
        for snap in policy_snaps:
            if snap["creation_ts"] and (now_ts - snap["creation_ts"]) > max_age:
                to_delete.append(snap)

    # Check which snapshots are needed by replication tasks
    repl_protected = set()
    if to_delete:
        db = get_db()
        try:
            rows = db.execute(
                "SELECT last_snapshot FROM zfs_replication_tasks WHERE last_snapshot IS NOT NULL AND enabled = 1"
            ).fetchall()
            repl_protected = {r[0] for r in rows}
        finally:
            db.close()

    for snap in to_delete:
        snap_name = snap["name"]
        if snap_name in repl_protected:
            logger.info(f"Retention cleanup: skipping {snap_name} — needed by replication task")
            continue
        res = run(["zfs", "destroy", snap_name])
        if res.ok:
            logger.info(f"Retention cleanup: destroyed {snap_name}")
        else:
            logger.warning(f"Retention cleanup: failed to destroy {snap_name} — {res.stderr.strip()}")


def _scheduler_loop():
    """Main loop: poll DB for due policies and run them."""
    logger.info("Snapshot scheduler started")
    while True:
        try:
            db = get_db()
            try:
                rows = db.execute(
                    "SELECT * FROM snapshot_policies WHERE enabled = 1"
                ).fetchall()
                policies = [dict(r) for r in rows]
            finally:
                db.close()

            for policy in policies:
                try:
                    if _should_run(policy["schedule"], policy.get("last_run")):
                        _run_policy(policy)
                except Exception:
                    logger.exception(f"Error running snapshot policy '{policy.get('name')}' (id={policy.get('id')})")
        except Exception:
            logger.exception("Snapshot scheduler: error in poll loop")

        time.sleep(POLL_INTERVAL)


def start_snapshot_scheduler():
    """Start the snapshot scheduler in a daemon thread."""
    t = threading.Thread(target=_scheduler_loop, daemon=True, name="snapshot-scheduler")
    t.start()
    logger.info("Snapshot scheduler thread launched")
