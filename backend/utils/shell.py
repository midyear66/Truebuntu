import logging
import subprocess
import re
from dataclasses import dataclass

logger = logging.getLogger(__name__)

ALLOWED_COMMANDS = {
    "zpool",
    "zfs",
    "smartctl",
    "systemctl",
    "smbpasswd",
    "useradd",
    "userdel",
    "usermod",
    "groupadd",
    "groupdel",
    "passwd",
    "rclone",
    "lsblk",
    "blkid",
    "exportfs",
    "smbstatus",
    "hostname",
    "uptime",
    "cat",
    "getent",
    "chown",
    "chmod",
    "nsenter",
    "chpasswd",
    "hostnamectl",
    "timedatectl",
    "apt-get",
    "apt",
    "rsync",
    "crontab",
    "tee",
    "rm",
    "ip",
    "netplan",
    "ethtool",
    "resolvectl",
    "journalctl",
    "uname",
    "wipefs",
    "sgdisk",
    "blockdev",
    "which",
    "sed",
    "cp",
    "mkdir",
    "openvpn",
    "upsc",
}

# Note: Cron jobs and init/shutdown scripts may contain shell metacharacters
# (pipes, redirects, etc.). Those routers use subprocess.run() directly with
# nsenter instead of this module's run(), which blocks dangerous chars.

DANGEROUS_CHARS = re.compile(r"[;|&$`]")


@dataclass
class ShellResult:
    stdout: str
    stderr: str
    returncode: int

    @property
    def ok(self) -> bool:
        return self.returncode == 0


def run(args: list[str], timeout: int = 30, check: bool = False) -> ShellResult:
    if not args:
        raise ValueError("Empty command")

    cmd = args[0].split("/")[-1]
    if cmd not in ALLOWED_COMMANDS:
        raise ValueError(f"Command not allowed: {cmd}")

    for arg in args[1:]:
        if DANGEROUS_CHARS.search(arg):
            raise ValueError(f"Dangerous characters in argument: {arg}")

    logger.info(f"shell: {' '.join(args)}")

    try:
        proc = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout,
            shell=False,
        )
    except subprocess.TimeoutExpired:
        logger.error(f"Command timed out after {timeout}s: {' '.join(args)}")
        return ShellResult(stdout="", stderr=f"Command timed out after {timeout}s", returncode=-1)
    except FileNotFoundError:
        logger.error(f"Command not found: {args[0]}")
        return ShellResult(stdout="", stderr=f"Command not found: {args[0]}", returncode=-1)

    result = ShellResult(
        stdout=proc.stdout,
        stderr=proc.stderr,
        returncode=proc.returncode,
    )

    if proc.returncode != 0:
        logger.warning(f"Command failed (rc={proc.returncode}): {' '.join(args)}\nstderr: {proc.stderr.strip()}")

    if check and not result.ok:
        raise RuntimeError(f"Command failed: {' '.join(args)}\n{result.stderr}")

    return result
