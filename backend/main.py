import logging
import os

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, FileResponse
from starlette.middleware.base import BaseHTTPMiddleware

from backend.database import init_db, get_db
from backend.utils.auth import decode_token, COOKIE_NAME
from backend.routers import (
    auth, pools, datasets, snapshots, shares, nfs,
    users, services, tasks, disks, rclone, dashboard, migrate, config,
    system, enclosure, updates, totp,
    cron_jobs, init_shutdown, rsync_tasks, smart_tests, resilver,
)

logging.basicConfig(
    level=getattr(logging, os.environ.get("LOG_LEVEL", "info").upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Truebuntu", version="0.1.0")


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
            except Exception:
                pass
        return response


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


@app.on_event("startup")
def startup():
    init_db()
    logger.info("Truebuntu started")


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception(f"Unhandled error on {request.method} {request.url.path}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "static")

if os.path.isdir(STATIC_DIR):
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = os.path.join(STATIC_DIR, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        index = os.path.join(STATIC_DIR, "index.html")
        if os.path.isfile(index):
            return FileResponse(index)
        return JSONResponse(status_code=404, content={"detail": "Not found"})
