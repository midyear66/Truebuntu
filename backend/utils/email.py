import json
import logging
import smtplib
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


def send_alert(category: str, subject: str, body: str):
    try:
        categories = get_alert_settings()
        if not categories.get(category, False):
            return
        send_email(subject, body)
    except Exception:
        logger.exception(f"Alert send failed for category '{category}'")
