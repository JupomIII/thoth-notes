"""Short-lived pairing codes.

The iPad never handles the long-lived pairing token: it sends six characters
that are derived from a secret in ``backend/storage`` and the current ten-minute
time window, and receives the token over TLS on the local network. Codes rotate
by themselves, so a screenshot or a stale link stops working.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from pathlib import Path
from urllib.parse import urlencode

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I: easy to read aloud
CODE_LENGTH = 6
MAX_FAILURES = 8
FAILURE_WINDOW = 600.0


def _secret(cfg) -> bytes:
    path: Path = cfg.directory / "pair-secret"
    try:
        value = path.read_bytes().strip()
    except OSError:
        value = b""
    if len(value) < 16:
        value = secrets.token_bytes(32)
        try:
            path.write_bytes(value)
            path.chmod(0o600)
        except OSError:
            pass
    return value


def _window(cfg) -> int:
    return max(1, int(cfg.pair_code_minutes)) * 60


def code_for(cfg, at: float | None = None) -> str:
    moment = time.time() if at is None else at
    bucket = int(moment // _window(cfg))
    digest = hmac.new(_secret(cfg), f"pair:{bucket}".encode(), hashlib.sha256).digest()
    return "".join(ALPHABET[byte % len(ALPHABET)] for byte in digest[:CODE_LENGTH])


def current_code(cfg) -> str:
    return code_for(cfg)


def seconds_left(cfg) -> int:
    window = _window(cfg)
    return window - int(time.time()) % window


def verify(cfg, submitted: str, at: float | None = None) -> bool:
    cleaned = "".join(ch for ch in submitted.upper() if ch.isalnum())
    if len(cleaned) != CODE_LENGTH:
        return False
    moment = time.time() if at is None else at
    # The previous window is accepted so a code typed just before it rotated
    # still pairs.
    return any(
        secrets.compare_digest(code_for(cfg, moment - offset), cleaned)
        for offset in (0, _window(cfg))
    )


def pairing_link(cfg) -> str:
    query = urlencode({"server": cfg.base_url, "code": current_code(cfg)})
    return f"{cfg.pair_app_url.rstrip('/')}/#/sync?{query}"


_failures: dict[str, list[float]] = {}


def allow_attempt(client: str) -> bool:
    now = time.time()
    recent = [moment for moment in _failures.get(client, []) if now - moment < FAILURE_WINDOW]
    _failures[client] = recent
    return len(recent) < MAX_FAILURES


def record_failure(client: str) -> None:
    _failures.setdefault(client, []).append(time.time())


def reset_failures(client: str) -> None:
    _failures.pop(client, None)
