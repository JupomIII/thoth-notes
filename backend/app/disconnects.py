"""Keeps the operator console honest about clients that simply go away.

When a browser or an iPad closes a keep-alive connection, Windows' proactor event
loop reports the teardown callback as an exception::

    Exception in callback _ProactorBasePipeTransport._call_connection_lost()
    ConnectionResetError: [WinError 10054] An existing connection was forcibly
    closed by the remote host

That is a client leaving, not a fault, and printing a traceback between ordinary
request lines makes a healthy server look broken. Only that case is hushed here:
the transport teardown callback losing a connection that the peer already
closed. Everything else still reaches the loop's normal handler, so a real
failure in a callback, a task or a route is reported exactly as before.

The check is on exception types rather than on ``WinError`` codes, so the same
code keeps working on a non-Windows host, where the callback name simply never
appears.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from .accept_loop import is_transient_connection_error

log = logging.getLogger("thoth")

# The only callback whose teardown failure is a client walking away.
CLOSE_CALLBACK = "_call_connection_lost"

# A peer that vanished surfaces as one of these on every platform.
CLIENT_GONE_ERRORS = (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)


def is_client_gone(context: dict[str, Any]) -> bool:
    """True only for a lost connection during transport teardown."""
    exception = context.get("exception")
    if not isinstance(exception, CLIENT_GONE_ERRORS):
        return False
    return CLOSE_CALLBACK in str(context.get("message", ""))


def is_orphaned_accept(context: dict[str, Any]) -> bool:
    """True for the abandoned Windows accept task of a reset connection.

    ``IocpProactor.accept`` wraps its future in a coroutine whose only job is
    closing the candidate socket on cancellation. When the peer resets, that
    coroutine ends with the very same OSError and nobody collects it, so the loop
    reports "Task exception was never retrieved" for a client that has simply
    left. It is reported only by this one coroutine and only for a transient
    connection error; anything else stays loud.
    """
    if str(context.get("message", "")) != "Task exception was never retrieved":
        return False
    if not is_transient_connection_error(context.get("exception")):  # type: ignore[arg-type]
        return False
    return "accept_coro" in str(context.get("future", ""))


def install(loop: asyncio.AbstractEventLoop) -> None:
    """Hushes benign disconnects on ``loop`` and keeps every other report."""
    previous = loop.get_exception_handler()

    def handler(active: asyncio.AbstractEventLoop, context: dict[str, Any]) -> None:
        if is_client_gone(context) or is_orphaned_accept(context):
            log.debug("client closed the connection before the response")
            return
        if previous is not None:
            previous(active, context)
        else:
            active.default_exception_handler(context)

    loop.set_exception_handler(handler)
