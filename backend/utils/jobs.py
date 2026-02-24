import logging
import os
import signal
import subprocess
import threading
import time
from datetime import datetime, timedelta

from backend.database import get_db
from backend.utils.shell import ALLOWED_COMMANDS, DANGEROUS_CHARS

logger = logging.getLogger(__name__)

MAX_CONCURRENT = 4
MAX_OUTPUT_BYTES = 64 * 1024  # 64KB
NSENTER_PREFIX = ["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--"]


class JobManager:
    """Singleton job manager. Thread-safe via lock."""

    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    inst = super().__new__(cls)
                    inst._jobs = {}  # job_id -> {thread, process, cancel_event}
                    cls._instance = inst
        return cls._instance

    def submit(self, job_type, description, resource, started_by,
               cmd=None, shell_cmd=None, timeout=None, on_complete=None):
        """Submit a new job. Returns job_id. Raises ValueError for duplicates,
        RuntimeError if at max concurrency."""
        if not cmd and not shell_cmd:
            raise ValueError("Must provide cmd or shell_cmd")

        if cmd:
            binary = cmd[0].split("/")[-1]
            if binary not in ALLOWED_COMMANDS:
                raise ValueError(f"Command not allowed: {binary}")
            for arg in cmd[1:]:
                if DANGEROUS_CHARS.search(arg):
                    raise ValueError(f"Dangerous characters in argument: {arg}")

        db = get_db()
        try:
            # Check for duplicate resource
            if resource:
                row = db.execute(
                    "SELECT id FROM jobs WHERE resource = ? AND status IN ('pending', 'running')",
                    (resource,),
                ).fetchone()
                if row:
                    raise ValueError(f"Duplicate: job {row[0]} already active for resource '{resource}'")

            # Check concurrency limit
            count = db.execute(
                "SELECT COUNT(*) FROM jobs WHERE status IN ('pending', 'running')",
            ).fetchone()[0]
            if count >= MAX_CONCURRENT:
                raise RuntimeError(f"Max concurrent jobs ({MAX_CONCURRENT}) reached")

            cursor = db.execute(
                """INSERT INTO jobs (job_type, status, description, resource, started_by)
                   VALUES (?, 'pending', ?, ?, ?)""",
                (job_type, description, resource, started_by),
            )
            db.commit()
            job_id = cursor.lastrowid
        finally:
            db.close()

        cancel_event = threading.Event()
        t = threading.Thread(
            target=self._run_job,
            args=(job_id, cmd, shell_cmd, timeout, on_complete, cancel_event),
            daemon=True,
        )
        with self._lock:
            self._jobs[job_id] = {
                "thread": t,
                "process": None,
                "cancel_event": cancel_event,
            }
        t.start()
        return job_id

    def cancel(self, job_id):
        """Cancel a running job. Returns True if cancellation was initiated."""
        with self._lock:
            handle = self._jobs.get(job_id)
        if not handle:
            # Maybe it's in the DB but not in memory (already finished)
            db = get_db()
            try:
                row = db.execute(
                    "SELECT status FROM jobs WHERE id = ?", (job_id,)
                ).fetchone()
                if not row:
                    return False
                if row[0] in ("completed", "failed", "cancelled"):
                    return False
                # Mark as cancelled in DB directly
                db.execute(
                    "UPDATE jobs SET status = 'cancelled', finished_at = ?, error = 'Cancelled by user' WHERE id = ?",
                    (datetime.now().isoformat(), job_id),
                )
                db.commit()
                return True
            finally:
                db.close()

        handle["cancel_event"].set()
        proc = handle.get("process")
        if proc and proc.poll() is None:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            except (OSError, ProcessLookupError):
                pass
            # Give it 5 seconds then SIGKILL
            def _force_kill():
                time.sleep(5)
                if proc.poll() is None:
                    try:
                        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                    except (OSError, ProcessLookupError):
                        pass
            threading.Thread(target=_force_kill, daemon=True).start()
        return True

    def get_job(self, job_id):
        """Get full job detail from DB."""
        db = get_db()
        try:
            row = db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            if not row:
                return None
            return dict(row)
        finally:
            db.close()

    def list_jobs(self, status=None, job_type=None, limit=50, offset=0):
        """List jobs with optional filters."""
        db = get_db()
        try:
            query = "SELECT id, job_type, status, description, resource, started_by, created_at, started_at, finished_at, returncode, error FROM jobs"
            conditions = []
            params = []
            if status:
                conditions.append("status = ?")
                params.append(status)
            if job_type:
                conditions.append("job_type = ?")
                params.append(job_type)
            if conditions:
                query += " WHERE " + " AND ".join(conditions)
            query += " ORDER BY id DESC LIMIT ? OFFSET ?"
            params.extend([limit, offset])
            rows = db.execute(query, params).fetchall()
            return [dict(r) for r in rows]
        finally:
            db.close()

    def cleanup_stale(self):
        """On startup: mark stale jobs as failed, delete old jobs."""
        db = get_db()
        try:
            db.execute(
                "UPDATE jobs SET status = 'failed', error = 'Server restarted', finished_at = ? "
                "WHERE status IN ('pending', 'running')",
                (datetime.now().isoformat(),),
            )
            cutoff = (datetime.now() - timedelta(days=30)).isoformat()
            db.execute("DELETE FROM jobs WHERE finished_at < ? AND status IN ('completed', 'failed', 'cancelled')", (cutoff,))
            db.commit()
            logger.info("Job queue: cleaned up stale jobs")
        finally:
            db.close()

    def _run_job(self, job_id, cmd, shell_cmd, timeout, on_complete, cancel_event):
        """Execute a job in a background thread."""
        db = get_db()
        try:
            db.execute(
                "UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?",
                (datetime.now().isoformat(), job_id),
            )
            db.commit()
        finally:
            db.close()

        stdout_chunks = []
        stderr_chunks = []

        try:
            if shell_cmd:
                full_cmd = NSENTER_PREFIX + ["sh", "-c", shell_cmd]
                proc = subprocess.Popen(
                    full_cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    start_new_session=True,
                )
            else:
                proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    start_new_session=True,
                )

            # Store process handle for cancellation
            with self._lock:
                if job_id in self._jobs:
                    self._jobs[job_id]["process"] = proc

            # Store PID in DB
            db = get_db()
            try:
                db.execute("UPDATE jobs SET pid = ? WHERE id = ?", (proc.pid, job_id))
                db.commit()
            finally:
                db.close()

            # Reader threads for stdout/stderr to avoid deadlocks
            def _read_stream(stream, chunks):
                total = 0
                for line in stream:
                    if total < MAX_OUTPUT_BYTES:
                        chunks.append(line)
                        total += len(line)

            stdout_thread = threading.Thread(target=_read_stream, args=(proc.stdout, stdout_chunks), daemon=True)
            stderr_thread = threading.Thread(target=_read_stream, args=(proc.stderr, stderr_chunks), daemon=True)
            stdout_thread.start()
            stderr_thread.start()

            # Wait for completion with timeout and cancel checks
            start_time = time.time()
            while proc.poll() is None:
                if cancel_event.is_set():
                    try:
                        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                    except (OSError, ProcessLookupError):
                        pass
                    proc.wait(timeout=5)
                    break
                if timeout and (time.time() - start_time) > timeout:
                    try:
                        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                    except (OSError, ProcessLookupError):
                        pass
                    try:
                        proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        try:
                            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                        except (OSError, ProcessLookupError):
                            pass
                        proc.wait()
                    stderr_chunks.append(f"\nJob timed out after {timeout}s\n")
                    break
                time.sleep(0.5)

            stdout_thread.join(timeout=5)
            stderr_thread.join(timeout=5)

            stdout_text = "".join(stdout_chunks)[:MAX_OUTPUT_BYTES]
            stderr_text = "".join(stderr_chunks)[:MAX_OUTPUT_BYTES]
            returncode = proc.returncode

            if cancel_event.is_set():
                status = "cancelled"
                error_msg = "Cancelled by user"
            elif timeout and (time.time() - start_time) > timeout:
                status = "failed"
                error_msg = f"Timed out after {timeout}s"
            elif returncode == 0:
                status = "completed"
                error_msg = ""
            else:
                status = "failed"
                error_msg = stderr_text[:500] if stderr_text else f"Exit code: {returncode}"

        except Exception as e:
            logger.exception(f"Job {job_id} failed with exception")
            stdout_text = "".join(stdout_chunks)[:MAX_OUTPUT_BYTES]
            stderr_text = str(e)
            returncode = -1
            status = "failed"
            error_msg = str(e)

        # Update final state in DB
        db = get_db()
        try:
            db.execute(
                "UPDATE jobs SET status = ?, finished_at = ?, stdout = ?, stderr = ?, returncode = ?, error = ? WHERE id = ?",
                (status, datetime.now().isoformat(), stdout_text, stderr_text, returncode, error_msg, job_id),
            )
            db.commit()
        finally:
            db.close()

        # Clean up in-memory handle
        with self._lock:
            self._jobs.pop(job_id, None)

        # Run on_complete callback
        if on_complete:
            try:
                on_complete(job_id, status, stdout_text, stderr_text, returncode)
            except Exception:
                logger.exception(f"on_complete callback failed for job {job_id}")

        logger.info(f"Job {job_id} finished: status={status} rc={returncode}")
