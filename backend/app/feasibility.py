"""Plain-HTTP feasibility probe.

This is a throwaway diagnostic server, not part of the sync product. It exists to
answer one question on real hardware: can the HTTPS GitHub Pages app reach a
plain ``http://<lan-ip>:8787`` server on the Windows laptop?

Run it separately from the real server:

    backend\\.venv\\Scripts\\python.exe -m app.feasibility

It deliberately has no TLS, no certificate and no token: the only thing under
test is whether the browser lets the request leave the page at all.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse

from .config import host_name, local_ip

DEFAULT_PORT = 8787

app = FastAPI(title="Thoth Notes local HTTP probe", docs_url=None, redoc_url=None)


def _cors(response):
    """Permissive CORS: the point is to reach the network, not to gate it."""
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "*"
    response.headers["Access-Control-Max-Age"] = "600"
    # Chromium 142+ asks before a public page talks to a private address.
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.middleware("http")
async def permissive_cors(request: Request, call_next):
    if request.method == "OPTIONS":
        return _cors(JSONResponse({"ok": True}))
    return _cors(await call_next(request))


def _payload() -> dict:
    return {
        "ok": True,
        "service": "thoth-notes-feasibility",
        "device": host_name(),
        "lanIp": local_ip(),
        "port": int(os.environ.get("THOTH_PROBE_PORT", DEFAULT_PORT)),
        "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "note": "Plain HTTP, no certificate, no token. Reachability test only.",
    }


@app.get("/health")
def health() -> dict:
    return _payload()


@app.get("/sync/test")
def sync_test() -> dict:
    return {
        "ok": True,
        "method": "GET",
        "message": "The browser reached the laptop over plain HTTP.",
        "device": host_name(),
        "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


@app.post("/sync/test")
async def sync_test_post(request: Request) -> dict:
    body = await request.body()
    return {
        "ok": True,
        "method": "POST",
        "message": "The browser reached the laptop over plain HTTP.",
        "received": body.decode("utf-8", "replace")[:2048],
        "device": host_name(),
        "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    info = _payload()
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Thoth Notes · local HTTP probe</title>
<style>
 :root {{ color-scheme: light dark; }}
 body {{ font: 16px/1.6 ui-serif, Georgia, serif; margin: 0; padding: 2rem 1.25rem;
        background: #faf8f4; color: #211f1c; }}
 @media (prefers-color-scheme: dark) {{ body {{ background: #171614; color: #ece7de; }} }}
 h1 {{ font-size: 1.35rem; margin: 0 0 .25rem; }}
 p {{ margin: .35rem 0; }}
 code {{ font: .9em ui-monospace, Consolas, monospace; background: rgba(127,127,127,.16);
         padding: .1em .35em; border-radius: 4px; }}
 ul {{ padding-left: 1.1rem; }}
 .muted {{ opacity: .7; font-size: .9rem; }}
</style></head><body>
<h1>Local HTTP probe is running</h1>
<p class="muted">{info["device"]} · {info["lanIp"]}:{info["port"]} · plain HTTP, no certificate</p>
<ul>
  <li><a href="/health">/health</a></li>
  <li><a href="/sync/test">/sync/test</a></li>
</ul>
<p class="muted">Opening this page on the iPad proves the LAN path works. The mixed-content
test in the app is what decides whether the HTTPS page may call this server.</p>
</body></html>"""


def main() -> None:
    import uvicorn

    port = int(os.environ.get("THOTH_PROBE_PORT", DEFAULT_PORT))
    address = local_ip()
    print()
    print("  Thoth Notes · plain HTTP feasibility probe")
    print("  -----------------------------------------")
    print(f"  LAN address : http://{address}:{port}/health")
    print(f"  Same laptop : http://127.0.0.1:{port}/health")
    print("  No TLS, no certificate, no token. Ctrl+C to stop.")
    print()
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")


if __name__ == "__main__":
    main()
