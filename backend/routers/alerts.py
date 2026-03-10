import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.database import get_db
from backend.utils.auth import get_current_admin
from backend.utils.email import send_email, dispatch_to_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/alerts", tags=["alerts"], dependencies=[Depends(get_current_admin)])

VALID_SERVICE_TYPES = {"slack", "pagerduty", "pushover", "webhook"}


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
    scrub_failures: bool = False
    pool_degraded: bool = False
    pool_capacity: bool = False


class AlertServiceRequest(BaseModel):
    name: str
    type: str
    config: dict = {}
    enabled: bool = True


class AlertServiceUpdateRequest(BaseModel):
    name: str | None = None
    config: dict | None = None
    enabled: bool | None = None


# ─── SMTP ───────────────────────────────────────────────────────────────────

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
def save_smtp_config(req: SmtpConfig, username: str = Depends(get_current_admin)):
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
def test_email(username: str = Depends(get_current_admin)):
    try:
        send_email(
            "Truebuntu Test Email",
            "This is a test email from Truebuntu. If you received this, email alerts are configured correctly.",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send test email: {e}")

    logger.info(f"User '{username}' sent test email")
    return {"message": "Test email sent"}


# ─── Alert Categories ───────────────────────────────────────────────────────

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
            "scrub_failures": False,
            "pool_degraded": False,
            "pool_capacity": False,
        }
    finally:
        db.close()


@router.put("/settings")
def save_alert_settings(req: AlertCategories, username: str = Depends(get_current_admin)):
    db = get_db()
    try:
        categories = {
            "cron_failures": req.cron_failures,
            "rsync_failures": req.rsync_failures,
            "smart_failures": req.smart_failures,
            "replication_failures": req.replication_failures,
            "scrub_failures": req.scrub_failures,
            "pool_degraded": req.pool_degraded,
            "pool_capacity": req.pool_capacity,
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


# ─── Alert Services ─────────────────────────────────────────────────────────

SENSITIVE_KEYS = {"webhook_url", "integration_key", "api_token", "user_key"}


def _mask_config(config: dict) -> dict:
    """Mask sensitive values in service config for display."""
    masked = {}
    for k, v in config.items():
        if k in SENSITIVE_KEYS and v:
            masked[k] = v[:4] + "****" + v[-4:] if len(v) > 8 else "********"
        else:
            masked[k] = v
    return masked


@router.get("/services")
def list_alert_services():
    db = get_db()
    try:
        rows = db.execute("SELECT * FROM alert_services ORDER BY id").fetchall()
        result = []
        for row in rows:
            svc = dict(row)
            svc["config"] = _mask_config(json.loads(svc["config"]))
            result.append(svc)
        return result
    finally:
        db.close()


@router.post("/services")
def create_alert_service(req: AlertServiceRequest, username: str = Depends(get_current_admin)):
    if req.type not in VALID_SERVICE_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid service type: {req.type}")
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="Name is required")

    # Validate required config per type
    if req.type == "slack" and not req.config.get("webhook_url"):
        raise HTTPException(status_code=400, detail="Slack webhook URL is required")
    if req.type == "pagerduty" and not req.config.get("integration_key"):
        raise HTTPException(status_code=400, detail="PagerDuty integration key is required")
    if req.type == "pushover":
        if not req.config.get("user_key") or not req.config.get("api_token"):
            raise HTTPException(status_code=400, detail="Pushover user key and API token are required")
    if req.type == "webhook" and not req.config.get("url"):
        raise HTTPException(status_code=400, detail="Webhook URL is required")

    db = get_db()
    try:
        cursor = db.execute(
            "INSERT INTO alert_services (name, type, config, enabled) VALUES (?, ?, ?, ?)",
            (req.name.strip(), req.type, json.dumps(req.config), int(req.enabled)),
        )
        db.commit()
        svc_id = cursor.lastrowid
    finally:
        db.close()

    logger.info(f"User '{username}' created alert service '{req.name}' (type={req.type}, id={svc_id})")
    return {"message": "Alert service created", "id": svc_id}


@router.put("/services/{service_id}")
def update_alert_service(service_id: int, req: AlertServiceUpdateRequest, username: str = Depends(get_current_admin)):
    db = get_db()
    try:
        existing = db.execute("SELECT * FROM alert_services WHERE id = ?", (service_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Alert service not found")

        ALLOWED_FIELDS = {"name", "config", "enabled"}
        updates = {}
        if req.name is not None:
            updates["name"] = req.name.strip()
        if req.config is not None:
            # Merge: keep existing secret values if new ones are masked
            old_config = json.loads(existing["config"])
            new_config = {}
            for k, v in req.config.items():
                if v and "****" in str(v) and k in old_config:
                    new_config[k] = old_config[k]
                else:
                    new_config[k] = v
            updates["config"] = json.dumps(new_config)
        if req.enabled is not None:
            updates["enabled"] = int(req.enabled)

        updates = {k: v for k, v in updates.items() if k in ALLOWED_FIELDS}
        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            db.execute(
                f"UPDATE alert_services SET {set_clause} WHERE id = ?",
                (*updates.values(), service_id),
            )
            db.commit()
    finally:
        db.close()

    logger.info(f"User '{username}' updated alert service id={service_id}")
    return {"message": "Alert service updated"}


@router.delete("/services/{service_id}")
def delete_alert_service(service_id: int, username: str = Depends(get_current_admin)):
    db = get_db()
    try:
        result = db.execute("DELETE FROM alert_services WHERE id = ?", (service_id,))
        db.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Alert service not found")
    finally:
        db.close()

    logger.info(f"User '{username}' deleted alert service id={service_id}")
    return {"message": "Alert service deleted"}


@router.post("/services/{service_id}/test")
def test_alert_service(service_id: int, username: str = Depends(get_current_admin)):
    db = get_db()
    try:
        row = db.execute("SELECT * FROM alert_services WHERE id = ?", (service_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Alert service not found")
        service = dict(row)
        service["config"] = json.loads(service["config"])
    finally:
        db.close()

    try:
        dispatch_to_service(
            service,
            "Truebuntu Test Notification",
            "This is a test notification from Truebuntu. If you received this, the alert service is configured correctly.",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Test failed: {e}")

    logger.info(f"User '{username}' tested alert service id={service_id}")
    return {"message": "Test notification sent"}
