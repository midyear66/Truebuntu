"""Tests for the first-run claim token.

This token is the only thing standing between a freshly started container and
anyone on the network claiming the admin account — and with it the web shell's
root access to the host.
"""
from backend.utils import setup_claim


def _reset():
    setup_claim.clear_claim_token()


def test_no_token_is_active_until_one_is_minted():
    _reset()
    assert setup_claim.claim_token_active() is False
    assert setup_claim.verify_claim_token("anything") is False


def test_ensure_is_idempotent_within_a_process():
    _reset()
    first = setup_claim.ensure_claim_token()
    second = setup_claim.ensure_claim_token()
    assert first == second
    assert setup_claim.claim_token_active() is True


def test_the_minted_token_verifies():
    _reset()
    token = setup_claim.ensure_claim_token()
    assert setup_claim.verify_claim_token(token) is True


def test_surrounding_whitespace_is_tolerated():
    """Operators paste this out of a log; a stray newline should not reject it."""
    _reset()
    token = setup_claim.ensure_claim_token()
    assert setup_claim.verify_claim_token(f"  {token}\n") is True


def test_wrong_or_missing_tokens_are_rejected():
    _reset()
    token = setup_claim.ensure_claim_token()
    assert setup_claim.verify_claim_token("") is False
    assert setup_claim.verify_claim_token(None) is False
    assert setup_claim.verify_claim_token(token[:-1]) is False
    assert setup_claim.verify_claim_token(token + "0") is False
    assert setup_claim.verify_claim_token(token.upper()) is False


def test_clearing_retires_the_token():
    """After setup completes the token must stop working."""
    _reset()
    token = setup_claim.ensure_claim_token()
    setup_claim.clear_claim_token()
    assert setup_claim.claim_token_active() is False
    assert setup_claim.verify_claim_token(token) is False


def test_a_new_token_is_unrelated_to_the_retired_one():
    _reset()
    first = setup_claim.ensure_claim_token()
    setup_claim.clear_claim_token()
    second = setup_claim.ensure_claim_token()
    assert first != second
    assert setup_claim.verify_claim_token(first) is False
    assert setup_claim.verify_claim_token(second) is True


def test_token_is_long_enough_to_resist_guessing():
    _reset()
    token = setup_claim.ensure_claim_token()
    # 16 bytes of entropy rendered as hex.
    assert len(token) == 32
    assert all(c in "0123456789abcdef" for c in token)
