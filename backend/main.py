import logging
import os

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, FileResponse
from starlette.middleware.base import BaseHTTPMiddleware
from slowapi.errors import RateLimitExceeded

from backend.database import init_db, get_db
from backend.utils.auth import decode_token, COOKIE_NAME
from backend.utils.rate_limit import limiter
from backend.routers import (
    auth, pools, datasets, snapshots, shares, nfs,
    users, services, tasks, disks, rclone, dashboard, migrate, config,
    system, enclosure, updates, totp,
    network, cron_jobs, init_shutdown, rsync_tasks, smart_tests, resilver,
    replication, logs, alerts, jobs,
    ddns, ftp, ups, openvpn, snmp, shell, smb_users,
)

logging.basicConfig(
    level=getattr(logging, os.environ.get("LOG_LEVEL", "info").upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Truebuntu", version="0.1.0")

# Rate limiter
app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"detail": "Too many requests. Please try again later."},
    )


# Audit logging middleware
MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


class AuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if (
            request.method in MUTATING_METHODS
            and request.url.path.startswith("/api/")
            and response.status_code < 400
        ):
            username = "anonymous"
            token = request.cookies.get(COOKIE_NAME)
            if token:
                user = decode_token(token)
                if user:
                    username = user
            try:
                db = get_db()
                db.execute(
                    "INSERT INTO audit_log (username, action, resource, ip_address) VALUES (?, ?, ?, ?)",
                    (username, request.method, request.url.path, request.client.host if request.client else ""),
                )
                db.commit()
                db.close()
            except Exception as exc:
                logger.warning("Audit log write failed: %s", exc)
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"
        # CSP on non-API routes
        if not request.url.path.startswith("/api/"):
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; "
                "script-src 'self'; "
                "style-src 'self' 'unsafe-inline'; "
                "connect-src 'self' ws: wss:; "
                "img-src 'self' data: blob:; "
                "font-src 'self' data:; "
                "frame-ancestors 'none'"
            )
        return response


app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(AuditMiddleware)

# Register routers
app.include_router(auth.router, prefix="/api")
app.include_router(pools.disks_router, prefix="/api")
app.include_router(pools.router, prefix="/api")
app.include_router(datasets.router, prefix="/api")
app.include_router(snapshots.router, prefix="/api")
app.include_router(snapshots.policies_router, prefix="/api")
app.include_router(shares.router, prefix="/api")
app.include_router(nfs.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(services.router, prefix="/api")
app.include_router(tasks.router, prefix="/api")
app.include_router(disks.router, prefix="/api")
app.include_router(rclone.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(migrate.router, prefix="/api")
app.include_router(config.router, prefix="/api")
app.include_router(system.router, prefix="/api")
app.include_router(enclosure.router, prefix="/api")
app.include_router(updates.router, prefix="/api")
app.include_router(totp.router, prefix="/api")
app.include_router(cron_jobs.router, prefix="/api")
app.include_router(init_shutdown.router, prefix="/api")
app.include_router(rsync_tasks.router, prefix="/api")
app.include_router(smart_tests.router, prefix="/api")
app.include_router(resilver.router, prefix="/api")
app.include_router(network.router, prefix="/api")
app.include_router(replication.router, prefix="/api")
app.include_router(logs.router, prefix="/api")
app.include_router(alerts.router, prefix="/api")
app.include_router(jobs.router, prefix="/api")
app.include_router(ddns.router, prefix="/api")
app.include_router(ftp.router, prefix="/api")
app.include_router(ups.router, prefix="/api")
app.include_router(openvpn.router, prefix="/api")
app.include_router(snmp.router, prefix="/api")
app.include_router(shell.router, prefix="/api")
app.include_router(smb_users.router, prefix="/api")


@app.on_event("startup")
def startup():
    init_db()
    from backend.utils.jobs import JobManager
    JobManager().cleanup_stale()
    logger.info("Truebuntu started")


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception(f"Unhandled error on {request.method} {request.url.path}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


STATIC_DIR = os.path.realpath(os.path.join(os.path.dirname(__file__), "..", "static"))

if os.path.isdir(STATIC_DIR):
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = os.path.realpath(os.path.join(STATIC_DIR, full_path))
        if not file_path.startswith(STATIC_DIR + os.sep) and file_path != STATIC_DIR:
            return JSONResponse(status_code=400, content={"detail": "Invalid path"})
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        index = os.path.join(STATIC_DIR, "index.html")
        if os.path.isfile(index):
            return FileResponse(index)
        return JSONResponse(status_code=404, content={"detail": "Not found"})
