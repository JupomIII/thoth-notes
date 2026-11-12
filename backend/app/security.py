"""LAN-only access control and pairing-token authentication."""

from __future__ import annotations

import ipaddress
import secrets
from typing import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

PUBLIC_PATHS = {"/api/health"}


def is_trusted_client(host: str | None) -> bool:
    if not host:
        return False
    if host in {"testclient", "localhost"}:
        return True
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    if address.version == 6 and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    return address.is_loopback or address.is_private or address.is_link_local


class LocalNetworkMiddleware(BaseHTTPMiddleware):
    """Rejects public clients outright and requires the pairing token for APIs."""

    def __init__(self, app: Callable[..., Awaitable[Response]], token_provider, config) -> None:
        super().__init__(app)
        self.token_provider = token_provider
        self.config = config

    async def dispatch(self, request: Request, call_next):
        client_host = request.client.host if request.client else None
        if not is_trusted_client(client_host):
            return JSONResponse(
                {"detail": "This server only accepts private network clients."}, status_code=403
            )

        path = request.url.path
        if path.startswith("/api") and path not in PUBLIC_PATHS:
            expected = self.token_provider()
            provided = request.headers.get("x-thoth-token", "")
            if not expected or not provided or not secrets.compare_digest(expected, provided):
                return JSONResponse({"detail": "Invalid or missing pairing token."}, status_code=401)

        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        return response


def allowed_origin_regex(config) -> str | None:
    # Browsers omit Origin for same-origin requests, so the app served by this
    # server works without any CORS entry at all.
    return config.allow_origin_regex if getattr(config, "allow_origin_regex", None) else None
