import json
import logging
import smtplib
import urllib.request
import urllib.error
from email.mime.text import MIMEText

from backend.database import get_db

logger = logging.getLogger(__name__)


def get_smtp_settings() -> dict:
    db = get_db()
    try:
        rows = db.execute(
            "SELECT key, value FROM settings WHERE key LIKE 'smtp_%'"
        ).fetchall()
        return {r["key"]: r["value"] for r in rows}
    finally:
        db.close()


def get_alert_settings() -> dict:
    db = get_db()
    try:
        row = db.execute(
            "SELECT value FROM settings WHERE key = 'alert_categories'"
        ).fetchone()
        if row:
            return json.loads(row["value"])
        return {}
    finally:
        db.close()


def get_alert_services() -> list[dict]:
    db = get_db()
    try:
        rows = db.execute(
            "SELECT * FROM alert_services WHERE enabled = 1"
        ).fetchall()
        result = []
        for row in rows:
            svc = dict(row)
            svc["config"] = json.loads(svc["config"])
            result.append(svc)
        return result
    except Exception:
        return []
    finally:
        db.close()


def send_email(subject: str, body: str):
    settings = get_smtp_settings()
    host = settings.get("smtp_host", "")
    port = int(settings.get("smtp_port", "587"))
    user = settings.get("smtp_user", "")
    password = settings.get("smtp_password", "")
    from_addr = settings.get("smtp_from", user)
    recipients = settings.get("smtp_recipients", "")
    use_tls = settings.get("smtp_tls", "1") == "1"

    if not host or not recipients:
        logger.warning("SMTP not configured, skipping email")
        return

    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = recipients

    to_list = [r.strip() for r in recipients.split(",") if r.strip()]

    try:
        if use_tls:
            server = smtplib.SMTP(host, port, timeout=10)
            server.starttls()
        else:
            server = smtplib.SMTP(host, port, timeout=10)
        if user and password:
            server.login(user, password)
        server.sendmail(from_addr, to_list, msg.as_string())
        server.quit()
        logger.info(f"Email sent: {subject}")
    except Exception:
        logger.exception(f"Failed to send email: {subject}")
        raise


def _post_json(url: str, payload: dict, headers: dict | None = None, timeout: int = 10):
    """POST JSON to a URL using stdlib (no requests dependency)."""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status


def send_slack(webhook_url: str, subject: str, body: str):
    _post_json(webhook_url, {"text": f"*{subject}*\n{body}"})
    logger.info(f"Slack notification sent: {subject}")


def send_pagerduty(integration_key: str, subject: str, body: str):
    _post_json(
        "https://events.pagerduty.com/v2/enqueue",
        {
            "routing_key": integration_key,
            "event_action": "trigger",
            "payload": {
                "summary": subject,
                "source": "truebuntu",
                "severity": "error",
                "custom_details": {"body": body},
            },
        },
    )
    logger.info(f"PagerDuty notification sent: {subject}")


def send_pushover(user_key: str, api_token: str, subject: str, body: str):
    _post_json(
        "https://api.pushover.net/1/messages.json",
        {
            "token": api_token,
            "user": user_key,
            "title": subject,
            "message": body,
        },
    )
    logger.info(f"Pushover notification sent: {subject}")


def send_webhook(url: str, subject: str, body: str, headers: dict | None = None):
    _post_json(url, {"subject": subject, "body": body}, headers=headers)
    logger.info(f"Webhook notification sent: {subject}")


def dispatch_to_service(service: dict, subject: str, body: str):
    """Send notification to a single alert service."""
    svc_type = service["type"]
    config = service["config"]
    try:
        if svc_type == "slack":
            send_slack(config["webhook_url"], subject, body)
        elif svc_type == "pagerduty":
            send_pagerduty(config["integration_key"], subject, body)
        elif svc_type == "pushover":
            send_pushover(config["user_key"], config["api_token"], subject, body)
        elif svc_type == "webhook":
            send_webhook(config["url"], subject, body, config.get("headers"))
        else:
            logger.warning(f"Unknown alert service type: {svc_type}")
    except Exception:
        logger.exception(f"Failed to dispatch to {svc_type} service '{service.get('name', '?')}'")


def send_alert(category: str, subject: str, body: str):
    try:
        categories = get_alert_settings()
        if not categories.get(category, False):
            return

        # Send email
        try:
            send_email(subject, body)
        except Exception:
            logger.exception(f"Email alert failed for category '{category}'")

        # Dispatch to all enabled alert services
        for service in get_alert_services():
            dispatch_to_service(service, subject, body)

    except Exception:
        logger.exception(f"Alert send failed for category '{category}'")
