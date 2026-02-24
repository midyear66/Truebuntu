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
from backend.utils.auth import decode_token, COOKIE_NAME

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/shell", tags=["shell"])


@router.websocket("/ws")
async def shell_ws(websocket: WebSocket):
    # Auth: extract nas_session cookie, decode JWT, reject if invalid
    token = websocket.cookies.get(COOKIE_NAME)
    username = decode_token(token) if token else None
    if not username:
        await websocket.close(code=4401, reason="Not authenticated")
        return

    await websocket.accept()
    logger.info("Shell session started for user %s", username)

    child_pid, master_fd = pty.fork()

    if child_pid == 0:
        # Child process: set TERM and exec nsenter into host namespace
        os.environ["TERM"] = "xterm-256color"
        os.execvp("nsenter", [
            "nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p",
            "--", "/bin/bash",
        ])
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
        try:
            os.waitpid(child_pid, os.WNOHANG)
        except OSError:
            pass
        logger.info("Shell session ended for user %s", username)
