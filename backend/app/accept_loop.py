"""Keeps the listener alive when a client aborts while it is being accepted.

On Windows, asyncio's proactor accept loop answers a reset connection with
``OSError(64)`` / ``ConnectionResetError``, reports "Accept failed on a socket"
and then **closes the listening socket**. The process stays up but accepts
nothing further, so one client that vanishes at the wrong moment makes the whole
local server unreachable until it is restarted.

This replaces that accept loop with the same logic, except that a transient
connection error re-arms the listener instead of tearing it down. Any other
``OSError`` (a closed socket, a resource limit, a real bind problem) keeps the
stock behaviour and is still reported.

The patch only applies where ``ProactorEventLoop`` exists; on a non-Windows host
the selector loop already survives this and nothing is replaced.
"""

from __future__ import annotations

import asyncio
import errno
import inspect
import logging
from typing import Any

try:  # asyncio's socket wrapper only exists to keep reprs safe in log output.
    from asyncio.trsock import TransportSocket as _TransportSocket
except ImportError:  # pragma: no cover - private module moved or removed
    _TransportSocket = None

log = logging.getLogger("thoth")

# A peer that leaves during the handshake, on Windows and on POSIX.
TRANSIENT_ACCEPT_CODES = {
    errno.ECONNABORTED,
    errno.ECONNRESET,
    errno.EPIPE,
    10052,  # WSAENETRESET
    10053,  # WSAECONNABORTED
    10054,  # WSAECONNRESET
    10061,  # WSAECONNREFUSED
    64,  # WSAENETNAME: "the specified network name is no longer available"
}

# A poisoned backlog clears on its own; a socket that keeps failing is real.
MAX_CONSECUTIVE_RETRIES = 20
RETRY_DELAY_SECONDS = 0.05

_installed = False


def is_transient_connection_error(error: BaseException) -> bool:
    """True for the connection drops a vanishing client produces."""
    if not isinstance(error, OSError):
        return False
    codes = {getattr(error, "errno", None), getattr(error, "winerror", None)}
    return any(code in TRANSIENT_ACCEPT_CODES for code in codes if code is not None)


def _report_and_close(loop: Any, sock: Any, exc: OSError) -> None:
    """The stock behaviour: say what happened, then stop listening."""
    if sock.fileno() == -1:
        return
    loop.call_exception_handler(
        {
            "message": "Accept failed on a socket",
            "exception": exc,
            "socket": _TransportSocket(sock) if _TransportSocket else sock,
        }
    )
    sock.close()


def _start_serving(self, protocol_factory, sock, sslcontext=None, server=None, backlog=100,
                   ssl_handshake_timeout=None, ssl_shutdown_timeout=None):
    """A copy of asyncio's accept loop where a reset does not stop the listener."""
    attempts = 0

    def arm(delay: float | None = None) -> None:
        if delay:
            self.call_later(delay, run)
        else:
            self.call_soon(run)

    def run(fut: Any = None) -> None:
        nonlocal attempts
        try:
            if fut is not None:
                conn, addr = fut.result()
                protocol = protocol_factory()
                if sslcontext is not None:
                    self._make_ssl_transport(
                        conn,
                        protocol,
                        sslcontext,
                        server_side=True,
                        extra={"peername": addr},
                        server=server,
                        ssl_handshake_timeout=ssl_handshake_timeout,
                        ssl_shutdown_timeout=ssl_shutdown_timeout,
                    )
                else:
                    self._make_socket_transport(conn, protocol, extra={"peername": addr}, server=server)
            if self.is_closed():
                return
            fut = self._proactor.accept(sock)
        except OSError as exc:
            attempts += 1
            if is_transient_connection_error(exc) and attempts <= MAX_CONSECUTIVE_RETRIES:
                # Someone left before we finished accepting them: stay listening.
                log.debug("client aborted during accept; listener kept open")
                arm(RETRY_DELAY_SECONDS)
                return
            _report_and_close(self, sock, exc)
            return
        except asyncio.CancelledError:
            sock.close()
            return
        else:
            attempts = 0
            self._accept_futures[sock.fileno()] = fut
            fut.add_done_callback(run)

    self.call_soon(run)


REQUIRED_PARAMETERS = {
    "protocol_factory",
    "sock",
    "sslcontext",
    "server",
    "backlog",
    "ssl_handshake_timeout",
    "ssl_shutdown_timeout",
}


def install() -> bool:
    """Applies the patch once. Returns True when this host needed it.

    A Python release that changes the accept hook simply keeps asyncio's own
    loop: the server must start, even if that means the old behaviour.
    """
    global _installed
    loop_class = getattr(asyncio, "ProactorEventLoop", None)
    if loop_class is None or _installed:
        return False
    base = loop_class.__mro__[1] if loop_class.__mro__ else None
    if base is None or not hasattr(base, "_start_serving"):
        return False
    if not REQUIRED_PARAMETERS.issubset(inspect.signature(base._start_serving).parameters):
        log.warning("accept loop left untouched: this Python changed its signature")
        return False
    base._start_serving = _start_serving
    _installed = True
    return True
