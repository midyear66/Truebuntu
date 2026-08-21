"""Tests for session token validation.

resolve_session() is the single gate in front of every authenticated entry
point, including the WebSocket that opens a root shell on the host. The two
regressions it exists to prevent are both covered here: a revoked token being
accepted, and a pending-2FA token being replayed as a session cookie.
"""
import os
import tempfile

import pytest

from backend.utils import auth


@pytest.fixture
def db(monkeypatch):
    """A real SQLite database on a temp path, with one user."""
    import backend.database as database

    path = os.path.join(tempfile.mkdtemp(), "nas.db")
    monkeypatch.setattr(database, "DATABASE_PATH", path)
    database.init_db()

    conn = database.get_db()
    conn.execute(
        "INSERT INTO users (username, password_hash, is_admin) VALUES ('alice', 'x', 1)"
    )
    conn.commit()
    conn.close()
    return database


def set_token_version(database, version):
    conn = database.get_db()
    conn.execute("UPDATE users SET token_version = ? WHERE username = 'alice'", (version,))
    conn.commit()
    conn.close()


# --- happy path --------------------------------------------------------------

def test_a_freshly_issued_token_resolves(db):
    assert auth.resolve_session(auth.create_token("alice", 0)) == "alice"


def test_missing_or_malformed_tokens_are_rejected(db):
    assert auth.resolve_session(None) is None
    assert auth.resolve_session("") is None
    assert auth.resolve_session("not.a.jwt") is None


def test_a_token_for_an_unknown_user_is_rejected(db):
    assert auth.resolve_session(auth.create_token("mallory", 0)) is None


def test_a_token_signed_with_another_key_is_rejected(db):
    import jwt
    forged = jwt.encode(
        {"sub": "alice", "ver": 0, "type": "session"},
        "the-wrong-key",
        algorithm=auth.ALGORITHM,
    )
    assert auth.resolve_session(forged) is None


def test_an_expired_token_is_rejected(db):
    import jwt
    from datetime import datetime, timedelta, timezone

    expired = jwt.encode(
        {
            "sub": "alice",
            "ver": 0,
            "type": "session",
            "exp": datetime.now(timezone.utc) - timedelta(hours=1),
        },
        auth.SECRET_KEY,
        algorithm=auth.ALGORITHM,
    )
    assert auth.resolve_session(expired) is None


# --- revocation --------------------------------------------------------------

def test_a_revoked_token_is_rejected(db):
    """What logout and password change rely on. The shell used to skip this."""
    stale = auth.create_token("alice", 0)
    set_token_version(db, 1)
    assert auth.resolve_session(stale) is None


def test_a_token_issued_after_revocation_still_works(db):
    set_token_version(db, 1)
    assert auth.resolve_session(auth.create_token("alice", 1)) == "alice"


# --- 2FA replay --------------------------------------------------------------

def test_a_pending_2fa_token_cannot_be_used_as_a_session(db):
    """The bypass this check exists for.

    A pending-2FA token carries no `ver` claim, so before the type check it
    defaulted to 0 and matched any user who had never logged out. Anyone who
    knew the password could take the nas_2fa_pending cookie handed out at step
    one of login, replay it as nas_session, and skip the second factor.
    """
    set_token_version(db, 0)  # the vulnerable state: a fresh account
    pending = auth.create_pending_2fa_token("alice")
    assert auth.resolve_session(pending) is None


def test_a_pending_2fa_token_still_works_for_its_own_purpose(db):
    pending = auth.create_pending_2fa_token("alice")
    assert auth.decode_pending_2fa_token(pending) == "alice"


def test_a_session_token_is_not_accepted_as_a_pending_2fa_token(db):
    session = auth.create_token("alice", 0)
    assert auth.decode_pending_2fa_token(session) is None


def test_tokens_of_an_unrecognised_type_are_rejected(db):
    import jwt
    odd = jwt.encode(
        {"sub": "alice", "ver": 0, "type": "password-reset"},
        auth.SECRET_KEY,
        algorithm=auth.ALGORITHM,
    )
    assert auth.resolve_session(odd) is None


# --- TOTP secret encryption --------------------------------------------------

def test_totp_secrets_round_trip():
    secret = "JBSWY3DPEHPK3PXP"
    encrypted = auth.encrypt_totp_secret(secret)
    assert encrypted != secret
    assert encrypted.startswith("gAAAAA")  # what the v9 migration keys off
    assert auth.decrypt_totp_secret(encrypted) == secret
