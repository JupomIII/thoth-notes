"""Self-signed local CA + server certificate for iPadOS trust.

The CA is generated once and kept in storage/certs. The server certificate is
issued for the machine's LAN hostname and IP addresses; the CA is exported as a
DER .cer file that can be installed on iPadOS.
"""

from __future__ import annotations

import datetime as dt
import ipaddress
import os
import socket
from pathlib import Path

from .config import Settings, settings as global_settings, local_ip, host_name


def _crypto():
    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import NameOID
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise RuntimeError(
            "The 'cryptography' package is required to generate certificates. "
            "Install it with: pip install cryptography"
        ) from exc
    return x509, hashes, serialization, rsa, NameOID


def _write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    if path.suffix == ".pem":
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass


def ensure_certificates(
    cfg: Settings | None = None,
    extra_hosts: list[str] | None = None,
    force: bool = False,
) -> dict[str, object]:
    config = cfg or global_settings
    if config.cert_file.exists() and config.key_file.exists() and not force:
        return {
            "created": False,
            "cert": str(config.cert_file),
            "key": str(config.key_file),
            "ca": str(config.ca_file),
        }

    x509, hashes, serialization, rsa, NameOID = _crypto()
    now = dt.datetime.now(dt.timezone.utc)

    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    ca_name = x509.Name(
        [
            x509.NameAttribute(NameOID.COMMON_NAME, "Thoth Notes Local CA"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Thoth Notes"),
        ]
    )
    ca_cert = (
        x509.CertificateBuilder()
        .subject_name(ca_name)
        .issuer_name(ca_name)
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(days=1))
        .not_valid_after(now + dt.timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .sign(ca_key, hashes.SHA256())
    )

    server_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    hostname = host_name()
    dns_names = {f"{hostname.lower()}.local", hostname.lower(), "localhost"}
    ip_values = {local_ip(), "127.0.0.1"}
    for extra in extra_hosts or []:
        candidate = extra.strip()
        if not candidate:
            continue
        try:
            ipaddress.ip_address(candidate)
            ip_values.add(candidate)
        except ValueError:
            dns_names.add(candidate.lower())

    san = [x509.DNSName(name) for name in sorted(dns_names)] + [
        x509.IPAddress(ipaddress.ip_address(value)) for value in sorted(ip_values)
    ]

    server_cert = (
        x509.CertificateBuilder()
        .subject_name(
            x509.Name(
                [
                    x509.NameAttribute(NameOID.COMMON_NAME, f"{hostname.lower()}.local"),
                    x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Thoth Notes"),
                ]
            )
        )
        .issuer_name(ca_cert.subject)
        .public_key(server_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(days=1))
        .not_valid_after(now + dt.timedelta(days=730))
        .add_extension(x509.SubjectAlternativeName(san), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.ExtendedKeyUsage([x509.oid.ExtendedKeyUsageOID.SERVER_AUTH]),
            critical=False,
        )
        .sign(ca_key, hashes.SHA256())
    )

    _write(
        config.key_file,
        server_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        ),
    )
    _write(
        config.cert_file,
        server_cert.public_bytes(serialization.Encoding.PEM)
        + ca_cert.public_bytes(serialization.Encoding.PEM),
    )
    ca_pem = config.cert_dir / "thoth-rootCA.pem"
    _write(ca_pem, ca_cert.public_bytes(serialization.Encoding.PEM))
    _write(config.ca_file, ca_cert.public_bytes(serialization.Encoding.DER))

    config.save()
    return {
        "created": True,
        "cert": str(config.cert_file),
        "key": str(config.key_file),
        "ca": str(config.ca_file),
        "hostname": f"{hostname.lower()}.local",
        "ips": sorted(ip_values),
        "dns": sorted(dns_names),
    }


def server_hostname() -> str:
    return socket.gethostname()
