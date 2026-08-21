"""Tests for the background job runner's outcome classification.

A job's recorded status is what the UI shows and what decides whether an alert
email goes out, so misclassifying a success as a timeout is not cosmetic.

The nsenter prefix is emptied so commands run locally instead of needing PID 1.
"""
import os
import tempfile
import time

import pytest


@pytest.fixture
def jobs(monkeypatch):
    import backend.database as database
    import backend.utils.jobs as jobs_module

    path = os.path.join(tempfile.mkdtemp(), "nas.db")
    monkeypatch.setattr(database, "DATABASE_PATH", path)
    database.init_db()

    monkeypatch.setattr(jobs_module, "NSENTER_PREFIX", [])

    yield jobs_module

    # Drain before teardown. Job threads outlive the call that started them, and
    # a straggler writing its final state after DATABASE_PATH has been restored
    # races the next test's fixture — an intermittent "no such table" that would
    # look like a real failure in CI.
    manager = jobs_module.JobManager()
    for job_id in list(manager._jobs):
        manager.cancel(job_id)
    deadline = time.time() + 20
    while manager._jobs and time.time() < deadline:
        time.sleep(0.05)


def wait_for(manager, job_id, limit=40):
    deadline = time.time() + limit
    while time.time() < deadline:
        job = manager.get_job(job_id)
        if job and job["status"] in ("completed", "failed", "cancelled"):
            return job
        time.sleep(0.1)
    raise AssertionError(f"job {job_id} never reached a terminal state")


def test_a_job_that_exits_zero_is_not_recorded_as_a_timeout(jobs):
    """The regression this classification was rewritten for.

    The command exits 0 immediately, but a backgrounded child holds the stdout
    pipe open, so the reader-thread joins block for several seconds afterwards.
    The old code re-read the wall clock after those joins, saw more elapsed time
    than the timeout allowed, and filed a successful job as a timeout.
    """
    manager = jobs.JobManager()
    job_id = manager.submit(
        "test", "exits 0 while a child holds the pipe", "res-success", "tester",
        shell_cmd="sleep 8 & exit 0", timeout=3,
    )
    job = wait_for(manager, job_id)

    assert job["status"] == "completed"
    assert job["returncode"] == 0
    assert job["error"] == ""


def test_a_job_that_overruns_is_still_a_timeout(jobs):
    manager = jobs.JobManager()
    job_id = manager.submit(
        "test", "runs too long", "res-timeout", "tester",
        shell_cmd="sleep 30", timeout=2,
    )
    job = wait_for(manager, job_id)

    assert job["status"] == "failed"
    assert job["error"] == "Timed out after 2s"


def test_a_nonzero_exit_is_a_plain_failure(jobs):
    manager = jobs.JobManager()
    job_id = manager.submit(
        "test", "exits 3", "res-fail", "tester",
        shell_cmd="echo nope >&2; exit 3", timeout=10,
    )
    job = wait_for(manager, job_id)

    assert job["status"] == "failed"
    assert job["returncode"] == 3
    assert "Timed out" not in job["error"]
    assert "nope" in job["stderr"]


def test_stdout_is_captured(jobs):
    manager = jobs.JobManager()
    job_id = manager.submit(
        "test", "prints", "res-stdout", "tester",
        shell_cmd="echo hello-from-the-job", timeout=10,
    )
    job = wait_for(manager, job_id)
    assert "hello-from-the-job" in job["stdout"]


def test_the_allowlist_rejects_an_unknown_binary(jobs):
    manager = jobs.JobManager()
    try:
        manager.submit("test", "nope", "res-denied", "tester", cmd=["definitely-not-allowed"])
    except ValueError as exc:
        assert "not allowed" in str(exc)
    else:
        raise AssertionError("expected ValueError for a command outside the allowlist")


def test_a_second_job_for_the_same_resource_is_refused(jobs):
    manager = jobs.JobManager()
    first = manager.submit(
        "test", "holds the resource", "res-exclusive", "tester",
        shell_cmd="sleep 5", timeout=20,
    )
    try:
        manager.submit(
            "test", "wants the same resource", "res-exclusive", "tester",
            shell_cmd="sleep 1", timeout=20,
        )
    except ValueError as exc:
        assert "Duplicate" in str(exc)
    else:
        raise AssertionError("expected ValueError for a duplicate resource")
    finally:
        manager.cancel(first)
        wait_for(manager, first)


def test_cleanup_stale_fails_jobs_left_running_by_a_crash(jobs):
    import backend.database as database

    conn = database.get_db()
    conn.execute(
        "INSERT INTO jobs (job_type, status, description, resource, started_by) "
        "VALUES ('test', 'running', 'orphaned by a restart', 'res-orphan', 'tester')"
    )
    conn.commit()
    job_id = conn.execute("SELECT MAX(id) FROM jobs").fetchone()[0]
    conn.close()

    jobs.JobManager().cleanup_stale()

    job = jobs.JobManager().get_job(job_id)
    assert job["status"] == "failed"
    assert job["error"] == "Server restarted"
