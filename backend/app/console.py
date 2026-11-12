"""Console helpers.

Windows consoles default to a legacy code page (cp437/cp850/cp1252), so printing
a path that contains non-ASCII characters - the project folder is called
"NŌTA" - raises UnicodeEncodeError and kills the process before Uvicorn starts.
Switching the streams to UTF-8 with replacement keeps startup working in
PowerShell windows, cmd windows and redirected log files.
"""

from __future__ import annotations

import sys


def enable_utf8_output() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (OSError, ValueError):  # pragma: no cover - unusual consoles
            pass
