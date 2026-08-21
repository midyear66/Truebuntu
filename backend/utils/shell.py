import logging
import subprocess
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# A typo catcher, not a security boundary. Every admin of this appliance can
# already run arbitrary commands as root on the host — through the web shell,
# cron jobs, and init/shutdown scripts, all of which are features. What this set
# buys is that a caller passing a mistyped or unexpected binary fails loudly here
# instead of at the far end of a subprocess. See SECURITY.md for the real model.
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
    "pdbedit",
    "net",
}


@dataclass
class ShellResult:
    stdout: str
    stderr: str
    returncode: int

    @property
    def ok(self) -> bool:
        return self.returncode == 0


def run(args: list[str], timeout: int = 30, check: bool = False, stdin: str | None = None) -> ShellResult:
    if not args:
        raise ValueError("Empty command")

    cmd = args[0].split("/")[-1]
    if cmd not in ALLOWED_COMMANDS:
        raise ValueError(f"Command not allowed: {cmd}")

    logger.info(f"shell: {' '.join(args)}")

    try:
        proc = subprocess.run(
            args,
            input=stdin,
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
