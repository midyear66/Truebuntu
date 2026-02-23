import os
import sqlite3
import logging

logger = logging.getLogger(__name__)

DATABASE_PATH = os.environ.get("DATABASE_PATH", "/data/nas.db")

SCHEMA_VERSION = 2

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
