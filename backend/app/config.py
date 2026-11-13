"""Server configuration: files live under a single writable data directory."""

from __future__ import annotations

import json
import os
import socket
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = BACKEND_DIR / "storage"


def data_dir() -> Path:
    override = os.environ.get("THOTH_DATA_DIR")
    path = Path(override).expanduser() if override else DEFAULT_DATA_DIR
    path.mkdir(parents=True, exist_ok=True)
    return path


def local_ip() -> str:
    """Best-effort LAN address without sending packets anywhere."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("192.0.2.1", 9))
            return sock.getsockname()[0]
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return "127.0.0.1"


def host_name() -> str:
    return os.environ.get("COMPUTERNAME") or socket.gethostname()


@dataclass
class Settings:
    host: str = "0.0.0.0"
    port: int = 8443
    # Same-origin requests never need CORS; these cover the GitHub Pages app and
    # a local Vite dev server. Add your own origin in storage/config.json.
    allowed_origins: list[str] = field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"]
    )
    allow_origin_regex: str = r"https://[A-Za-z0-9-]+\.github\.io"
    # Where the pairing link opens the app; the code in the link expires quickly.
    pair_app_url: str = "https://jupomiii.github.io/thoth-notes"
    # Optional trusted HTTPS address for this server (Tailscale, Cloudflare
    # tunnel, reverse proxy). When set, the server speaks plain HTTP on the loop
    # back side of the tunnel and no local certificate is used at all.
    public_url: str = ""
    ca_valid_days: int = 1825
    leaf_valid_days: int = 397
    pair_code_minutes: int = 30
    rotate_keep: int = 7
    auto_backup_hours: int = 24
    max_json_bytes: int = 4 * 1024 * 1024
    max_asset_bytes: int = 120 * 1024 * 1024

    @property
    def directory(self) -> Path:
        return data_dir()

    @property
    def db_path(self) -> Path:
        return self.directory / "thoth.db"

    @property
    def blob_dir(self) -> Path:
        path = self.directory / "blobs"
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def backup_dir(self) -> Path:
        path = self.directory / "backups"
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def cert_dir(self) -> Path:
        path = self.directory / "certs"
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def token_path(self) -> Path:
        return self.directory / "pairing-token.txt"

    @property
    def config_path(self) -> Path:
        return self.directory / "config.json"

    @property
    def cert_file(self) -> Path:
        return self.cert_dir / "server-cert.pem"

    @property
    def key_file(self) -> Path:
        return self.cert_dir / "server-key.pem"

    @property
    def ca_file(self) -> Path:
        return self.cert_dir / "thoth-rootCA.cer"

    @property
    def ca_pem(self) -> Path:
        return self.cert_dir / "thoth-rootCA.pem"

    @property
    def ca_key_file(self) -> Path:
        return self.cert_dir / "ca-key.pem"

    @property
    def tunneled(self) -> bool:
        """True when a public HTTPS address fronts this server."""
        return bool(str(self.public_url).strip())

    @property
    def tls(self) -> bool:
        """True when Uvicorn should terminate TLS itself."""
        return (
            not self.tunneled
            and self.cert_file.exists()
            and self.key_file.exists()
        )

    @property
    def base_url(self) -> str:
        if self.tunneled:
            return str(self.public_url).strip().rstrip("/")
        scheme = "https" if self.tls else "http"
        return f"{scheme}://{local_ip()}:{self.port}"

    @property
    def setup_url(self) -> str:
        return f"{self.base_url}/setup"

    def load(self) -> "Settings":
        if self.config_path.exists():
            try:
                raw: dict[str, Any] = json.loads(self.config_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                raw = {}
            for key, value in raw.items():
                if hasattr(self, key):
                    setattr(self, key, value)
        if os.environ.get("THOTH_PORT"):
            self.port = int(os.environ["THOTH_PORT"])
        if os.environ.get("THOTH_ALLOWED_ORIGINS"):
            self.allowed_origins = [
                origin.strip()
                for origin in os.environ["THOTH_ALLOWED_ORIGINS"].split(",")
                if origin.strip()
            ]
        return self

    def save(self) -> None:
        self.config_path.write_text(
            json.dumps(asdict(self), indent=2),
            encoding="utf-8",
        )

    def ensure_token(self) -> str:
        if self.token_path.exists():
            token = self.token_path.read_text(encoding="utf-8").strip()
            if token:
                return token
        import secrets

        token = secrets.token_urlsafe(32)
        self.token_path.write_text(token + "\n", encoding="utf-8")
        try:
            os.chmod(self.token_path, 0o600)
        except OSError:
            pass
        return token

    def read_token(self) -> str:
        if not self.token_path.exists():
            return ""
        return self.token_path.read_text(encoding="utf-8").strip()


settings = Settings().load()
