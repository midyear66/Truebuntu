"""One-time claim token guarding first-run admin creation.

/auth/setup necessarily accepts unauthenticated requests — there is no account
to authenticate against yet. On a host-networked appliance that turns the gap
between the container starting and the operator reaching a browser into a window
where anyone on the network can claim the admin account, and with it the web
shell's root access to the host.

The token closes that window. It is generated in memory, never written to the
database, and printed to the container log, so claiming the appliance requires
being able to read the log ("docker compose logs truebuntu") rather than merely
being able to reach port 80.

Deliberately not persisted: a restart mints a fresh token and reprints it, so a
token glimpsed once does not stay valid forever, and there is no stale secret
left behind in the database after setup completes.
"""
import hmac
import logging
import secrets
import threading

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_token: str | None = None


def ensure_claim_token() -> str:
    """Return the active claim token, generating and logging one if absent.

    Safe to call repeatedly — the token is only minted once per process, so the
    banner is printed once rather than on every poll of /auth/setup-required.
    """
    global _token
    with _lock:
        if _token is None:
            _token = secrets.token_hex(16)
            _log_banner(_token)
        return _token


def verify_claim_token(candidate: str | None) -> bool:
    """Constant-time comparison against the active token."""
    with _lock:
        expected = _token
    if not expected or not candidate:
        return False
    return hmac.compare_digest(candidate.strip(), expected)


def clear_claim_token() -> None:
    """Retire the token once the admin account has been claimed."""
    global _token
    with _lock:
        _token = None


def claim_token_active() -> bool:
    with _lock:
        return _token is not None


def _log_banner(token: str) -> None:
    rule = "=" * 70
    logger.warning(
        "\n%s\n"
        "  TRUEBUNTU FIRST-RUN SETUP\n"
        "\n"
        "  No admin account exists yet. Open the web UI and enter this token to\n"
        "  create one:\n"
        "\n"
        "      %s\n"
        "\n"
        "  Anyone who can reach this server sees the setup page, but only someone\n"
        "  who can read this log can claim the account. A restart issues a new\n"
        "  token and prints it here again.\n"
        "%s",
        rule, token, rule,
    )
