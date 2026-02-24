import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.utils.auth import get_current_user, get_current_admin
from backend.utils.jobs import JobManager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/jobs", tags=["jobs"], dependencies=[Depends(get_current_user)])

mgr = JobManager()


@router.get("")
def list_jobs(
    status: str | None = None,
    job_type: str | None = None,
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
):
    return mgr.list_jobs(status=status, job_type=job_type, limit=limit, offset=offset)


@router.get("/{job_id}")
def get_job(job_id: int):
    job = mgr.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.post("/{job_id}/cancel")
def cancel_job(job_id: int, username: str = Depends(get_current_admin)):
    job = mgr.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] not in ("pending", "running"):
        raise HTTPException(status_code=400, detail=f"Cannot cancel job in '{job['status']}' state")
    ok = mgr.cancel(job_id)
    if not ok:
        raise HTTPException(status_code=400, detail="Could not cancel job")
    logger.info(f"User '{username}' cancelled job {job_id}")
    return {"message": f"Job {job_id} cancellation requested"}
