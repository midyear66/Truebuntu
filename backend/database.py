import os
import sqlite3
import logging

logger = logging.getLogger(__name__)

DATABASE_PATH = os.environ.get("DATABASE_PATH", "/data/nas.db")

SCHEMA_VERSION = 3

SCHEMA_V1 = """
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    schedule TEXT,
    config TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run TEXT,
    last_result TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS snapshot_policies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    dataset TEXT NOT NULL,
    recursive INTEGER NOT NULL DEFAULT 0,
    schedule TEXT NOT NULL,
    retention_count INTEGER NOT NULL DEFAULT 10,
    retention_unit TEXT NOT NULL DEFAULT 'count',
    naming_schema TEXT NOT NULL DEFAULT 'auto-%Y-%m-%d_%H-%M',
    exclude TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    username TEXT NOT NULL,
    action TEXT NOT NULL,
    resource TEXT NOT NULL,
    detail TEXT,
    ip_address TEXT
);
"""


def get_db() -> sqlite3.Connection:
    db = sqlite3.connect(DATABASE_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA foreign_keys=ON")
    return db


def init_db():
    os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)
    db = get_db()
    try:
        current_version = 0
        try:
            row = db.execute("SELECT MAX(version) FROM schema_version").fetchone()
            if row and row[0] is not None:
                current_version = row[0]
        except sqlite3.OperationalError:
            pass

        if current_version < 1:
            logger.info("Applying schema v1")
            db.executescript(SCHEMA_V1)
            db.execute(
                "INSERT OR REPLACE INTO schema_version (version) VALUES (?)",
                (1,),
            )
            db.commit()

        if current_version < 2:
            logger.info("Applying schema v2")
            db.execute("ALTER TABLE users ADD COLUMN totp_secret TEXT DEFAULT NULL")
            db.execute("ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0")
            db.execute(
                "INSERT OR REPLACE INTO schema_version (version) VALUES (?)",
                (2,),
            )
            db.commit()

        if current_version < 3:
            logger.info("Applying schema v3")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS cron_jobs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    command TEXT NOT NULL,
                    schedule TEXT NOT NULL DEFAULT '0 * * * *',
                    user TEXT NOT NULL DEFAULT 'root',
                    description TEXT NOT NULL DEFAULT '',
                    enabled INTEGER NOT NULL DEFAULT 1,
                    last_run TEXT,
                    last_result TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS init_shutdown_scripts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    type TEXT NOT NULL DEFAULT 'init',
                    when_run TEXT NOT NULL DEFAULT 'post',
                    command TEXT NOT NULL,
                    timeout INTEGER NOT NULL DEFAULT 30,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS rsync_tasks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    source TEXT NOT NULL,
                    destination TEXT NOT NULL,
                    direction TEXT NOT NULL DEFAULT 'push',
                    mode TEXT NOT NULL DEFAULT 'ssh',
                    remote_host TEXT NOT NULL DEFAULT '',
                    remote_port INTEGER NOT NULL DEFAULT 22,
                    remote_user TEXT NOT NULL DEFAULT 'root',
                    remote_path TEXT NOT NULL DEFAULT '',
                    schedule TEXT NOT NULL DEFAULT '0 0 * * *',
                    extra_args TEXT NOT NULL DEFAULT '',
                    recursive INTEGER NOT NULL DEFAULT 1,
                    archive INTEGER NOT NULL DEFAULT 1,
                    compress INTEGER NOT NULL DEFAULT 1,
                    delete_dest INTEGER NOT NULL DEFAULT 0,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    last_run TEXT,
                    last_result TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS smart_tests (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    disks TEXT NOT NULL DEFAULT '[]',
                    test_type TEXT NOT NULL DEFAULT 'short',
                    schedule TEXT NOT NULL DEFAULT '0 0 * * 0',
                    enabled INTEGER NOT NULL DEFAULT 1,
                    last_run TEXT,
                    last_result TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS resilver_config (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    enabled INTEGER NOT NULL DEFAULT 0,
                    begin_hour INTEGER NOT NULL DEFAULT 18,
                    begin_minute INTEGER NOT NULL DEFAULT 0,
                    end_hour INTEGER NOT NULL DEFAULT 6,
                    end_minute INTEGER NOT NULL DEFAULT 0,
                    weekdays TEXT NOT NULL DEFAULT '[1,2,3,4,5,6,7]',
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                INSERT OR IGNORE INTO resilver_config (id, enabled) VALUES (1, 0);
            """)
            db.execute(
                "INSERT OR REPLACE INTO schema_version (version) VALUES (?)",
                (3,),
            )
            db.commit()

        logger.info(f"Database initialized at {DATABASE_PATH} (schema v{SCHEMA_VERSION})")
    finally:
        db.close()


def admin_exists() -> bool:
    db = get_db()
    try:
        row = db.execute("SELECT COUNT(*) FROM users WHERE is_admin = 1").fetchone()
        return row[0] > 0
    finally:
        db.close()
