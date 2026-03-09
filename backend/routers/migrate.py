import json
import logging
import re
import sqlite3
import subprocess
import tarfile
import tempfile

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form

from backend.database import get_db
from backend.utils.auth import get_current_admin
from backend.utils.shell import run
from backend.utils.smb_conf import add_share, parse_smb_conf
from backend.utils.zfs import get_pool_mountpoints

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/migrate", tags=["migrate"], dependencies=[Depends(get_current_admin)])

VALID_USERNAME = re.compile(r"^[a-z_][a-z0-9_-]*$")
VALID_SHARE_NAME = re.compile(r"^[a-zA-Z0-9_. -]+$")
STATIC_PATH_PREFIXES = ("/mnt/", "/data/", "/pool/", "/tank/")


@router.post("/truenas")
async def preview_truenas_config(file: UploadFile = File(...), username: str = Depends(get_current_admin)):
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
    user_passwords: str = Form("{}"),
    import_users: str = Form("true"),
    import_smb_shares: str = Form("true"),
    username: str = Depends(get_current_admin),
):
    content = await file.read()
    try:
        parsed = _parse_truenas_tar(content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse config: {e}")

    try:
        passwords = json.loads(user_passwords)
    except json.JSONDecodeError:
        passwords = {}

    do_import_users = import_users.lower() == "true"
    do_import_smb_shares = import_smb_shares.lower() == "true"

    results = {}
    errors = []

    # Import system users
    if do_import_users and parsed.get("users"):
        created = 0
        skipped = 0
        for user in parsed["users"]:
            uname = user.get("username", "")
            uid = user.get("uid")
            # Skip builtin/system users
            if user.get("builtin") or not uname or uid is None or uid < 1000:
                skipped += 1
                continue
            # Normalize username for Linux
            linux_name = uname.lower().replace(".", "_")
            if not VALID_USERNAME.match(linux_name):
                errors.append(f"Skipped user '{uname}': invalid username")
                skipped += 1
                continue
            # Check if user already exists
            check = run(["getent", "passwd", linux_name])
            if check.ok:
                errors.append(f"Skipped user '{linux_name}': already exists")
                skipped += 1
                continue
            # Create the user's primary group if GID specified
            gid = user.get("gid")
            if gid and gid >= 1000:
                gcheck = run(["getent", "group", str(gid)])
                if not gcheck.ok:
                    run(["groupadd", "-g", str(gid), linux_name])
            # Create system user
            cmd = ["useradd", "-u", str(uid), "-m"]
            if gid and gid >= 1000:
                cmd.extend(["-g", str(gid)])
            cmd.append(linux_name)
            result = run(cmd)
            if not result.ok:
                errors.append(f"Failed to create user '{linux_name}': {result.stderr.strip()}")
                skipped += 1
                continue
            # Add to additional groups if they exist on the system
            for grp in user.get("groups", []):
                grp_check = run(["getent", "group", grp])
                if grp_check.ok:
                    run(["usermod", "-aG", grp, linux_name])
            # Set password if provided
            pw = passwords.get(uname) or passwords.get(linux_name)
            if pw and len(pw) >= 8:
                proc = subprocess.run(
                    ["chpasswd"],
                    input=f"{linux_name}:{pw}\n",
                    capture_output=True, text=True, timeout=10,
                )
                if proc.returncode != 0:
                    errors.append(f"User '{linux_name}' created but password set failed")
                # Also create SMB user if they had SMB in TrueNAS
                if user.get("has_smb", True):
                    proc = subprocess.run(
                        ["smbpasswd", "-a", "-s", linux_name],
                        input=f"{pw}\n{pw}\n",
                        capture_output=True, text=True, timeout=10,
                    )
                    if proc.returncode != 0:
                        errors.append(f"User '{linux_name}' created but SMB account failed")
            created += 1
        results["users"] = created
        if skipped:
            results["users_skipped"] = skipped

    # Import SMB shares
    if do_import_smb_shares and parsed.get("smb_shares"):
        created = 0
        skipped = 0
        existing = parse_smb_conf()
        existing_names = {n.lower() for n in existing}
        for share in parsed["smb_shares"]:
            name = share.get("name", "")
            path = share.get("path", "")
            if not name or not VALID_SHARE_NAME.match(name):
                errors.append(f"Skipped share '{name}': invalid name")
                skipped += 1
                continue
            pool_mounts = get_pool_mountpoints()
            path_valid = (
                any(path.startswith(p) for p in STATIC_PATH_PREFIXES)
                or any(path.startswith(m) for m in pool_mounts)
            )
            if not path or not path_valid:
                errors.append(f"Skipped share '{name}': invalid path '{path}'")
                skipped += 1
                continue
            if name.lower() in existing_names:
                errors.append(f"Skipped share '{name}': already exists")
                skipped += 1
                continue
            params = {
                "path": path,
                "browseable": "yes" if share.get("browsable", True) else "no",
                "read only": "yes" if share.get("read_only", False) else "no",
                "guest ok": "yes" if share.get("guest_ok", False) else "no",
            }
            if share.get("comment"):
                params["comment"] = share["comment"]
            if share.get("recycle_bin"):
                params["vfs objects"] = "recycle"
                params["recycle:repository"] = ".recycle/%U"
                params["recycle:keeptree"] = "yes"
                params["recycle:versions"] = "yes"
            if share.get("time_machine"):
                params["fruit:time machine"] = "yes"
                params["vfs objects"] = params.get("vfs objects", "") + " fruit streams_xattr"
                params["vfs objects"] = params["vfs objects"].strip()
            if share.get("hosts_allow"):
                params["hosts allow"] = share["hosts_allow"]
            if share.get("hosts_deny"):
                params["hosts deny"] = share["hosts_deny"]
            if share.get("aux_params"):
                for line in share["aux_params"].splitlines():
                    line = line.strip()
                    if "=" in line:
                        k, _, v = line.partition("=")
                        params[k.strip()] = v.strip()
            try:
                add_share(name, params)
                created += 1
            except Exception as e:
                errors.append(f"Failed to add share '{name}': {e}")
                skipped += 1
        if created > 0:
            run(["systemctl", "reload", "smbd"])
        results["smb_shares"] = created
        if skipped:
            results["smb_shares_skipped"] = skipped

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
    return {"message": "Migration applied", "imported": results, "errors": errors}


def _parse_truenas_tar(tar_bytes: bytes) -> dict:
    parsed = {
        "users": [],
        "groups": [],
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
            # Groups (build id->gid lookup)
            group_gid_map = {}  # group table id -> actual gid
            group_name_map = {}  # group table id -> group name
            try:
                rows = conn.execute(
                    "SELECT id, bsdgrp_group, bsdgrp_gid, bsdgrp_builtin FROM account_bsdgroups"
                ).fetchall()
                for row in rows:
                    group_gid_map[row["id"]] = row["bsdgrp_gid"]
                    group_name_map[row["id"]] = row["bsdgrp_group"]
                    parsed["groups"].append({
                        "name": row["bsdgrp_group"],
                        "gid": row["bsdgrp_gid"],
                        "builtin": bool(row["bsdgrp_builtin"]),
                    })
            except sqlite3.OperationalError:
                pass

            # Group memberships (user_id -> list of group names)
            user_groups = {}  # user table id -> [group_name, ...]
            try:
                rows = conn.execute(
                    "SELECT bsdgrpmember_user_id, bsdgrpmember_group_id FROM account_bsdgroupmembership"
                ).fetchall()
                for row in rows:
                    uid = row["bsdgrpmember_user_id"]
                    gname = group_name_map.get(row["bsdgrpmember_group_id"], "")
                    if gname:
                        user_groups.setdefault(uid, []).append(gname)
            except sqlite3.OperationalError:
                pass

            # Users
            try:
                rows = conn.execute(
                    "SELECT id, bsdusr_username, bsdusr_uid, bsdusr_group_id, "
                    "bsdusr_home, bsdusr_shell, bsdusr_full_name, bsdusr_builtin, "
                    "bsdusr_smb, bsdusr_locked, bsdusr_password_disabled "
                    "FROM account_bsdusers"
                ).fetchall()
                for row in rows:
                    # Resolve foreign key to actual GID
                    actual_gid = group_gid_map.get(row["bsdusr_group_id"], row["bsdusr_group_id"])
                    parsed["users"].append({
                        "username": row["bsdusr_username"],
                        "uid": row["bsdusr_uid"],
                        "gid": actual_gid,
                        "home": row["bsdusr_home"] or "",
                        "shell": row["bsdusr_shell"] or "",
                        "full_name": row["bsdusr_full_name"] or "",
                        "builtin": bool(row["bsdusr_builtin"]),
                        "has_smb": bool(row["bsdusr_smb"]),
                        "locked": bool(row["bsdusr_locked"]),
                        "password_disabled": bool(row["bsdusr_password_disabled"]),
                        "groups": user_groups.get(row["id"], []),
                    })
            except sqlite3.OperationalError:
                # Fall back to minimal columns
                try:
                    rows = conn.execute(
                        "SELECT bsdusr_username, bsdusr_uid, bsdusr_group_id FROM account_bsdusers"
                    ).fetchall()
                    for row in rows:
                        actual_gid = group_gid_map.get(row["bsdusr_group_id"], row["bsdusr_group_id"])
                        parsed["users"].append({
                            "username": row["bsdusr_username"],
                            "uid": row["bsdusr_uid"],
                            "gid": actual_gid,
                        })
                except sqlite3.OperationalError:
                    pass

            # SMB shares
            try:
                rows = conn.execute(
                    "SELECT cifs_name, cifs_path, cifs_comment, cifs_ro, cifs_browsable, "
                    "cifs_guestok, cifs_recyclebin, cifs_timemachine, cifs_enabled, "
                    "cifs_hostsallow, cifs_hostsdeny, cifs_auxsmbconf "
                    "FROM sharing_cifs_share"
                ).fetchall()
                for row in rows:
                    parsed["smb_shares"].append({
                        "name": row["cifs_name"],
                        "path": row["cifs_path"] or "",
                        "comment": row["cifs_comment"] or "",
                        "read_only": bool(row["cifs_ro"]),
                        "browsable": bool(row["cifs_browsable"]),
                        "guest_ok": bool(row["cifs_guestok"]),
                        "recycle_bin": bool(row["cifs_recyclebin"]),
                        "time_machine": bool(row["cifs_timemachine"]),
                        "enabled": bool(row["cifs_enabled"]),
                        "hosts_allow": row["cifs_hostsallow"] or "",
                        "hosts_deny": row["cifs_hostsdeny"] or "",
                        "aux_params": row["cifs_auxsmbconf"] or "",
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
