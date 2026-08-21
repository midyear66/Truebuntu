import os
import pty
import signal
import struct
import fcntl
import termios
import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from backend.utils.auth import resolve_session, COOKIE_NAME

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/shell", tags=["shell"])

# How long to wait for the PTY child to exit at each escalation step.
REAP_TIMEOUT = 5.0


async def _reap(child_pid: int) -> None:
    """Wait for the PTY child to exit — escalating to SIGKILL — and reap it.

    A bare waitpid(WNOHANG) straight after SIGTERM almost always returns (0, 0),
    because the child has not exited yet. That leaves a zombie for the life of
    the container, and docker-compose caps us at 256 PIDs, so one leaked zombie
    per terminal session eventually starves every subprocess call in the app.

    Only ever waits on our own child_pid: a broad waitpid(-1) would steal exit
    statuses from subprocess.Popen children owned by the job manager.
    """
    killed = False
    deadline = asyncio.get_running_loop().time() + REAP_TIMEOUT
    while True:
        try:
            pid, _ = os.waitpid(child_pid, os.WNOHANG)
        except ChildProcessError:
            return  # already reaped
        except OSError:
            return
        if pid == child_pid:
            return

        if asyncio.get_running_loop().time() >= deadline:
            if killed:
                logger.warning("Shell child %d survived SIGKILL; not reaped", child_pid)
                return
            try:
                os.kill(child_pid, signal.SIGKILL)
            except OSError:
                return
            killed = True
            deadline = asyncio.get_running_loop().time() + REAP_TIMEOUT

        await asyncio.sleep(0.05)


@router.websocket("/ws")
async def shell_ws(websocket: WebSocket):
    # Validate Origin header to prevent cross-site WebSocket hijacking
    origin = websocket.headers.get("origin", "")
    host = websocket.headers.get("host", "")
    if origin:
        from urllib.parse import urlparse
        origin_host = urlparse(origin).netloc
        if origin_host and origin_host != host:
            await websocket.close(code=4403, reason="Origin not allowed")
            return

    # Auth: resolve the nas_session cookie through the same path the HTTP
    # dependency uses, so a session revoked by logout or a password change
    # cannot still open a root shell for the rest of the token's 24h lifetime.
    username = resolve_session(websocket.cookies.get(COOKIE_NAME))
    if not username:
        await websocket.close(code=4401, reason="Not authenticated")
        return

    # Verify admin
    from backend.database import get_db
    db = get_db()
    try:
        row = db.execute("SELECT is_admin FROM users WHERE username = ?", (username,)).fetchone()
        if not row or not row["is_admin"]:
            await websocket.close(code=4403, reason="Admin access required")
            return
    finally:
        db.close()

    await websocket.accept()
    logger.info("Shell session started for user %s", username)

    child_pid, master_fd = pty.fork()

    if child_pid == 0:
        # Child process: set TERM and exec nsenter into the host namespace.
        # execvp raises rather than returns on failure, so every statement here
        # must sit inside the try — otherwise a missing nsenter drops the forked
        # child back into the parent's async handler as a duplicate process
        # sharing its event loop and database connections.
        try:
            os.environ["TERM"] = "xterm-256color"
            os.execvp("nsenter", [
                "nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p",
                "--", "/bin/bash",
            ])
        except BaseException:
            pass
        os._exit(1)

    loop = asyncio.get_event_loop()

    async def pty_to_ws():
        """Read from PTY master fd and send to WebSocket."""
        try:
            while True:
                try:
                    data = await loop.run_in_executor(
                        None, lambda: os.read(master_fd, 4096)
                    )
                    if not data:
                        break
                    await websocket.send_text(data.decode("utf-8", errors="replace"))
                except OSError:
                    break
        except (WebSocketDisconnect, Exception):
            pass

    async def ws_to_pty():
        """Read from WebSocket and write to PTY master fd."""
        try:
            while True:
                msg = await websocket.receive_text()
                # Check for resize messages (JSON)
                if msg.startswith("{"):
                    try:
                        payload = json.loads(msg)
                        if payload.get("type") == "resize":
                            cols = payload.get("cols", 80)
                            rows = payload.get("rows", 24)
                            winsize = struct.pack("HHHH", rows, cols, 0, 0)
                            fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
                            continue
                    except (ValueError, KeyError):
                        pass
                os.write(master_fd, msg.encode("utf-8"))
        except (WebSocketDisconnect, Exception):
            pass

    try:
        done, pending = await asyncio.wait(
            [asyncio.ensure_future(pty_to_ws()), asyncio.ensure_future(ws_to_pty())],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
    finally:
        try:
            os.kill(child_pid, signal.SIGTERM)
        except OSError:
            pass
        try:
            os.close(master_fd)
        except OSError:
            pass
        await _reap(child_pid)
        logger.info("Shell session ended for user %s", username)
