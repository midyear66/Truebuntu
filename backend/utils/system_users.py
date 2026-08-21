"""Host system-user operations, in one place.

Two things about this container make system-user management easy to get subtly
wrong, and both were being got wrong in different ways by different callers:

  * /etc/passwd and /etc/group are bind-mounted, so useradd run *inside* the
    container does write a real host account — but "useradd -m" then creates the
    home directory in the container's own filesystem, where it vanishes on the
    next rebuild. Anything touching accounts must run through nsenter so the
    host's filesystem is the one being modified.

  * Samba is the opposite. smbpasswd and friends operate on /etc/samba and
    /var/lib/samba, which are bind-mounted, so they are correct to run inside
    the container against the shared tdb files.

Keeping both rules in one module is what stops the two call sites drifting apart
again. Passwords are always delivered on stdin, never in argv, so they never
appear in /proc/<pid>/cmdline or the shell audit log.
"""
import logging
import subprocess

logger = logging.getLogger(__name__)

# Enter the host's mount, UTS, network, and IPC namespaces via PID 1.
NSENTER = ["nsenter", "-t", "1", "-m", "-u", "-n", "-i"]

DEFAULT_TIMEOUT = 10


def _host_run(args: list[str], stdin: str | None = None, timeout: int = DEFAULT_TIMEOUT):
    return subprocess.run(
        NSENTER + args,
        input=stdin,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def host_user_exists(username: str) -> bool:
    """True if the account exists on the host."""
    return _host_run(["getent", "passwd", username]).returncode == 0


def host_group_exists(group: str) -> bool:
    return _host_run(["getent", "group", group]).returncode == 0


def host_group_gid(group: str) -> str | None:
    """Return the numeric GID for a group name, or None if it does not exist."""
    proc = _host_run(["getent", "group", group])
    if proc.returncode != 0:
        return None
    parts = proc.stdout.strip().split(":")
    return parts[2] if len(parts) >= 3 else None


def create_host_group(name: str, gid: int | None = None) -> tuple[bool, str]:
    args = ["groupadd"]
    if gid is not None:
        args.extend(["-g", str(gid)])
    args.append(name)
    proc = _host_run(args)
    if proc.returncode != 0:
        return False, proc.stderr.strip() or "groupadd failed"
    return True, ""


def create_host_user(
    username: str,
    *,
    create_home: bool = True,
    uid: int | None = None,
    gid: str | int | None = None,
    groups: list[str] | None = None,
) -> tuple[bool, str]:
    """Create a system account on the host. Returns (ok, error_message)."""
    args = ["useradd"]
    if uid is not None:
        args.extend(["-u", str(uid)])
    if gid is not None:
        args.extend(["-g", str(gid)])
    args.append("-m" if create_home else "-M")
    if groups:
        args.extend(["-G", ",".join(groups)])
    args.append(username)

    proc = _host_run(args)
    if proc.returncode != 0:
        return False, proc.stderr.strip() or "useradd failed"
    return True, ""


def delete_host_user(username: str) -> tuple[bool, str]:
    proc = _host_run(["userdel", username])
    if proc.returncode != 0:
        return False, proc.stderr.strip() or "userdel failed"
    return True, ""


def add_host_user_to_group(username: str, group: str) -> tuple[bool, str]:
    proc = _host_run(["usermod", "-aG", group, username])
    if proc.returncode != 0:
        return False, proc.stderr.strip() or "usermod failed"
    return True, ""


def set_host_password(username: str, password: str) -> tuple[bool, str]:
    """Set the host account's password. Delivered on stdin, never in argv."""
    proc = _host_run(["chpasswd"], stdin=f"{username}:{password}\n")
    if proc.returncode != 0:
        return False, proc.stderr.strip() or "chpasswd failed"
    return True, ""


def set_samba_password(username: str, password: str) -> tuple[bool, str]:
    """Create or update the Samba account.

    Runs inside the container on purpose: /etc/samba and /var/lib/samba are
    bind-mounted, so the container and host share the same tdb files.
    """
    proc = subprocess.run(
        ["smbpasswd", "-a", "-s", username],
        input=f"{password}\n{password}\n",
        capture_output=True,
        text=True,
        timeout=DEFAULT_TIMEOUT,
    )
    if proc.returncode != 0:
        return False, proc.stderr.strip() or "smbpasswd failed"
    return True, ""


def delete_samba_password(username: str) -> tuple[bool, str]:
    proc = subprocess.run(
        ["smbpasswd", "-x", username],
        capture_output=True,
        text=True,
        timeout=DEFAULT_TIMEOUT,
    )
    if proc.returncode != 0:
        return False, proc.stderr.strip() or "smbpasswd -x failed"
    return True, ""
