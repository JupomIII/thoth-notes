"""Small command-line helper used by the PowerShell scripts."""

from __future__ import annotations

import argparse
import json
import sys

from . import PROTOCOL_VERSION
from .backup import manager as backups
from .config import host_name, local_ip, settings
from .database.db import init_db, connection


def cmd_init(args: argparse.Namespace) -> int:
    init_db(settings)
    token = settings.ensure_token()
    settings.save()
    result: dict[str, object] = {
        "protocol": PROTOCOL_VERSION,
        "dataDir": str(settings.directory),
        "token": token,
        "hostname": f"{host_name().lower()}.local",
        "lanIp": local_ip(),
        "port": settings.port,
    }
    if not args.no_cert:
        try:
            from .certs import ensure_certificates

            result["certificates"] = ensure_certificates(settings, extra_hosts=args.ip)
        except RuntimeError as exc:
            result["certificateError"] = str(exc)
    result["baseUrl"] = settings.base_url
    print(json.dumps(result, indent=2))
    return 0


def cmd_token(_args: argparse.Namespace) -> int:
    print(settings.ensure_token())
    return 0


def cmd_cert(args: argparse.Namespace) -> int:
    from .certs import ensure_certificates

    print(json.dumps(ensure_certificates(settings, extra_hosts=args.ip, force=args.force), indent=2))
    return 0


def cmd_backup(args: argparse.Namespace) -> int:
    init_db(settings)
    info = backups.create_backup(settings, reason=args.reason)
    print(json.dumps(info, indent=2))
    return 0


def cmd_status(_args: argparse.Namespace) -> int:
    init_db(settings)
    with connection() as conn:
        counts = {
            row["kind"]: int(row["total"])
            for row in conn.execute("SELECT kind, COUNT(*) AS total FROM objects GROUP BY kind")
        }
        conflicts = conn.execute("SELECT COUNT(*) AS total FROM conflicts").fetchone()["total"]
    print(
        json.dumps(
            {
                "dataDir": str(settings.directory),
                "baseUrl": settings.base_url,
                "counts": counts,
                "conflicts": conflicts,
                "tls": settings.cert_file.exists(),
                "tokenFile": str(settings.token_path),
            },
            indent=2,
        )
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="thoth", description="Thoth Notes server utilities")
    sub = parser.add_subparsers(dest="command")

    init = sub.add_parser("init", help="prepare database, token and local certificate")
    init.add_argument("--ip", action="append", default=[], help="extra IP or hostname for the certificate")
    init.add_argument("--no-cert", action="store_true", help="skip certificate generation")
    init.set_defaults(func=cmd_init)

    token = sub.add_parser("token", help="print the pairing token")
    token.set_defaults(func=cmd_token)

    cert = sub.add_parser("cert", help="(re)generate the local certificate")
    cert.add_argument("--ip", action="append", default=[])
    cert.add_argument("--force", action="store_true")
    cert.set_defaults(func=cmd_cert)

    backup = sub.add_parser("backup", help="write a ZIP backup now")
    backup.add_argument("--reason", default="cli")
    backup.set_defaults(func=cmd_backup)

    status = sub.add_parser("status", help="show counts and paths")
    status.set_defaults(func=cmd_status)

    args = parser.parse_args(argv)
    if not getattr(args, "func", None):
        parser.print_help()
        return 1
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
