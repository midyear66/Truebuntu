import logging
import os

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, FileResponse

from backend.database import init_db
from backend.routers import auth, pools

logging.basicConfig(
    level=getattr(logging, os.environ.get("LOG_LEVEL", "info").upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="NAS Web UI", version="0.1.0")

app.include_router(auth.router, prefix="/api")
app.include_router(pools.disks_router, prefix="/api")
app.include_router(pools.router, prefix="/api")


@app.on_event("startup")
def startup():
    init_db()
    logger.info("NAS Web UI started")


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
