"""The console must stay quiet for lost clients and loud for real faults."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.requests import ClientDisconnect

from app.disconnects import CLOSE_CALLBACK, install, is_client_gone
from app.main import client_closed


class RecordingLoop:
    """Stands in for an event loop: records what would have been printed."""

    def __init__(self) -> None:
        self.handler = None
        self.printed: list[dict[str, Any]] = []

    def get_exception_handler(self):
        return self.handler

    def set_exception_handler(self, handler) -> None:
        self.handler = handler

    def default_exception_handler(self, context: dict[str, Any]) -> None:
        self.printed.append(context)


def close_context(exception: BaseException) -> dict[str, Any]:
    return {"message": f"Exception in callback {CLOSE_CALLBACK}()", "exception": exception}


def test_a_reset_connection_at_teardown_is_a_client_leaving():
    assert is_client_gone(close_context(ConnectionResetError(10054, "connection forcibly closed"))) is True
    assert is_client_gone(close_context(ConnectionAbortedError(10053, "connection aborted"))) is True
    assert is_client_gone(close_context(BrokenPipeError(32, "broken pipe"))) is True


def test_every_other_failure_keeps_reporting():
    # Same exception, but somewhere a bug would live: must still be printed.
    assert is_client_gone({"message": "Task exception was never retrieved", "exception": ConnectionResetError(10054, "x")}) is False
    assert is_client_gone({"message": "Exception in callback Handler.handle_read()", "exception": ConnectionResetError(10054, "x")}) is False
    # Same callback, but a genuine fault: must still be printed.
    assert is_client_gone(close_context(ValueError("bad state"))) is False
    assert is_client_gone({"message": f"Exception in callback {CLOSE_CALLBACK}()"}) is False


def test_installed_handler_hushes_the_disconnect_and_prints_the_rest():
    loop = RecordingLoop()
    install(loop)

    loop.handler(loop, close_context(ConnectionResetError(10054, "x")))
    assert loop.printed == []

    real_fault = {"message": "Exception in callback _ProactorBasePipeTransport._call_connection_lost()", "exception": RuntimeError("disk is full")}
    loop.handler(loop, real_fault)
    assert loop.printed == [real_fault]


def test_installed_handler_passes_through_to_a_previous_handler():
    loop = RecordingLoop()
    seen: list[dict[str, Any]] = []
    loop.set_exception_handler(lambda _loop, context: seen.append(context))
    install(loop)

    context = {"message": "Exception in callback other()", "exception": OSError("boom")}
    loop.handler(loop, context)
    assert seen == [context]


def test_client_disconnect_answers_400_without_a_traceback():
    app = FastAPI()
    app.add_exception_handler(ClientDisconnect, client_closed)

    @app.get("/drop")
    async def drop() -> None:
        raise ClientDisconnect()

    with TestClient(app) as test_client:
        response = test_client.get("/drop")
    assert response.status_code == 400
    assert response.json()["detail"] == "client closed the connection"


def test_registering_the_disconnect_handler_does_not_swallow_real_errors():
    app = FastAPI()
    app.add_exception_handler(ClientDisconnect, client_closed)

    @app.get("/boom")
    def boom() -> None:
        raise RuntimeError("deliberate route failure")

    with TestClient(app, raise_server_exceptions=False) as test_client:
        response = test_client.get("/boom")
    assert response.status_code == 500


def test_transient_connection_errors_are_recognised():
    from app.accept_loop import is_transient_connection_error

    assert is_transient_connection_error(ConnectionResetError(10054, "reset")) is True
    assert is_transient_connection_error(ConnectionAbortedError(10053, "aborted")) is True
    assert is_transient_connection_error(OSError(0, "gone", None, 64)) is True
    # A resource or programming failure must keep reporting.
    assert is_transient_connection_error(OSError(0, "no handles", None, 10024)) is False
    assert is_transient_connection_error(ValueError("not a socket")) is False


def test_accept_loop_patch_is_applied_once_and_only_where_it_is_needed():
    import asyncio

    from app import accept_loop

    loop_class = getattr(asyncio, "ProactorEventLoop", None)
    if loop_class is None:  # POSIX: nothing to replace
        assert accept_loop.install() is False
        return
    base = loop_class.__mro__[1]
    assert base._start_serving is accept_loop._start_serving
    assert accept_loop.install() is False  # never installed twice


def test_abandoned_accept_task_of_a_reset_client_is_quiet():
    from app.disconnects import is_orphaned_accept

    context = {
        "message": "Task exception was never retrieved",
        "exception": ConnectionResetError(10054, "reset"),
        "future": "<Task finished name='Task-89' coro=<IocpProactor.accept.<locals>.accept_coro()>",
    }
    assert is_orphaned_accept(context) is True
    # A real task failure, or a different task, still reaches the console.
    assert is_orphaned_accept({**context, "exception": RuntimeError("boom")}) is False
    assert is_orphaned_accept({**context, "future": "<Task coro=<handler()>>"}) is False
