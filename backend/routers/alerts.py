import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.database import get_db
from backend.utils.auth import get_current_user
from backend.utils.email import send_email

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/alerts", tags=["alerts"], dependencies=[Depends(get_current_user)])


class SmtpConfig(BaseModel):
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_recipients: str = ""
    smtp_tls: bool = True


class AlertCategories(BaseModel):
    cron_failures: bool = False
    rsync_failures: bool = False
    smart_failures: bool = False
    replication_failures: bool = False


@router.get("/smtp")
def get_smtp_config():
    db = get_db()
    try:
        rows = db.execute("SELECT key, value FROM settings WHERE key LIKE 'smtp_%'").fetchall()
        config = {r["key"]: r["value"] for r in rows}
        # Mask password
        if "smtp_password" in config and config["smtp_password"]:
            config["smtp_password"] = "********"
        return config
    finally:
        db.close()


@router.put("/smtp")
def save_smtp_config(req: SmtpConfig, username: str = Depends(get_current_user)):
    db = get_db()
    try:
        settings = {
            "smtp_host": req.smtp_host,
            "smtp_port": str(req.smtp_port),
            "smtp_user": req.smtp_user,
            "smtp_from": req.smtp_from,
            "smtp_recipients": req.smtp_recipients,
            "smtp_tls": "1" if req.smtp_tls else "0",
        }
        # Only update password if not masked
        if req.smtp_password and req.smtp_password != "********":
            settings["smtp_password"] = req.smtp_password

        for key, value in settings.items():
            db.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                (key, value),
            )
        db.commit()
    finally:
        db.close()

    logger.info(f"User '{username}' updated SMTP config")
    return {"message": "SMTP config saved"}


@router.post("/test")
def test_email(username: str = Depends(get_current_user)):
    try:
        send_email(
            "Truebuntu Test Email",
            "This is a test email from Truebuntu. If you received this, email alerts are configured correctly.",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send test email: {e}")

    logger.info(f"User '{username}' sent test email")
    return {"message": "Test email sent"}


@router.get("/settings")
def get_alert_settings():
    db = get_db()
    try:
        row = db.execute("SELECT value FROM settings WHERE key = 'alert_categories'").fetchone()
        if row:
            return json.loads(row["value"])
        return {
            "cron_failures": False,
            "rsync_failures": False,
            "smart_failures": False,
            "replication_failures": False,
        }
    finally:
        db.close()


@router.put("/settings")
def save_alert_settings(req: AlertCategories, username: str = Depends(get_current_user)):
    db = get_db()
    try:
        categories = {
            "cron_failures": req.cron_failures,
            "rsync_failures": req.rsync_failures,
            "smart_failures": req.smart_failures,
            "replication_failures": req.replication_failures,
        }
        db.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            ("alert_categories", json.dumps(categories)),
        )
        db.commit()
    finally:
        db.close()

    logger.info(f"User '{username}' updated alert settings")
    return {"message": "Alert settings saved"}
