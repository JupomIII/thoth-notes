"""Local certificate authority and the laptop's TLS certificate.

The CA key is kept on this machine so the server certificate can be re-issued
for a new LAN address without the iPad having to install anything again: the
profile on the iPad trusts the CA, not the leaf.

Keys are ECDSA P-256 and every signature is SHA-256. Nothing here is uploaded
anywhere; the files stay in ``backend/storage/certs``.
"""

from __future__ import annotations

import datetime as dt
import ipaddress
import socket
from pathlib import Path

from .config import Settings, settings as global_settings, local_ip, host_name

CA_COMMON_NAME = "Thoth Notes Local CA"
LEAF_COMMON_NAME = "Thoth Notes on {host}"
RENEW_MARGIN = dt.timedelta(days=7)


def _crypto():
    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.x509.oid import NameOID
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise RuntimeError(
            "The 'cryptography' package is required to generate certificates. "
            "Install it with: pip install cryptography"
        ) from exc
    return x509, hashes, serialization, ec, NameOID


def _write(path: Path, payload: bytes, secret: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    try:
        path.chmod(0o600 if secret else 0o644)
    except OSError:  # pragma: no cover - Windows ACLs
        pass


def wanted_names(extra_hosts: list[str] | None = None) -> tuple[set[str], set[str]]:
    """Names and addresses the certificate must be valid for."""
    hostname = host_name().lower()
    dns = {"localhost", hostname, f"{hostname}.local"}
    ips = {"127.0.0.1", "::1", local_ip()}
    for extra in extra_hosts or []:
        candidate = (extra or "").strip()
        if not candidate:
            continue
        try:
            ipaddress.ip_address(candidate)
            ips.add(candidate)
        except ValueError:
            dns.add(candidate.lower())
        if candidate.lower().endswith(".local"):
            dns.add(candidate.lower()[: -len(".local")])
    return dns, ips


def _public_key_der(cert) -> bytes:
    _, _, serialization, _, _ = _crypto()
    return cert.public_key().public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )


def _key_id(cert) -> bytes:
    import hashlib

    return hashlib.sha1(_public_key_der(cert)).digest()  # noqa: S324 - key id, not a signature


def fingerprint_of(cfg: Settings | None = None) -> str:
    """SHA-256 fingerprint of the CA, in the form iOS shows in Settings."""
    import hashlib

    config = cfg or global_settings
    if not config.ca_file.exists():
        return ""
    digest = hashlib.sha256(config.ca_file.read_bytes()).hexdigest().upper()
    return ":".join(digest[index : index + 2] for index in range(0, len(digest), 2))


def _load_ca(cfg: Settings):
    x509, _, serialization, _, _ = _crypto()
    if not (cfg.ca_pem.exists() and cfg.ca_key_file.exists()):
        return None
    try:
        cert = x509.load_pem_x509_certificate(cfg.ca_pem.read_bytes())
        key = serialization.load_pem_private_key(cfg.ca_key_file.read_bytes(), password=None)
    except (ValueError, TypeError, OSError):
        return None
    return cert, key


def _make_ca(cfg: Settings):
    x509, hashes, serialization, ec, NameOID = _crypto()
    now = dt.datetime.now(dt.timezone.utc)
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name(
        [
            x509.NameAttribute(NameOID.COMMON_NAME, CA_COMMON_NAME),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Thoth Notes"),
        ]
    )
    ca = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=5))
        .not_valid_after(now + dt.timedelta(days=max(1, int(cfg.ca_valid_days))))
        # path_length=0: this CA may issue server certificates and nothing else.
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
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
        .add_extension(
            x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False
        )
        .sign(key, hashes.SHA256())
    )

    _write(
        cfg.ca_key_file,
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ),
        secret=True,
    )
    _write(cfg.ca_pem, ca.public_bytes(serialization.Encoding.PEM))
    _write(cfg.ca_file, ca.public_bytes(serialization.Encoding.DER))
    return ca, key


def _leaf_names(cfg: Settings):
    x509, _, _, _, _ = _crypto()
    if not cfg.cert_file.exists():
        return None
    try:
        pem = cfg.cert_file.read_bytes()
        leaf = x509.load_pem_x509_certificate(pem)
    except (ValueError, OSError):
        return None
    try:
        san = leaf.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    except x509.ExtensionNotFound:  # pragma: no cover - we always add it
        return None
    dns = {name.lower() for name in san.get_values_for_type(x509.DNSName)}
    ips = {str(value) for value in san.get_values_for_type(x509.IPAddress)}
    return leaf, dns, ips


def _leaf_is_usable(cfg: Settings, dns: set[str], ips: set[str]) -> bool:
    found = _leaf_names(cfg)
    if not found:
        return False
    leaf, have_dns, have_ips = found
    if not dns.issubset(have_dns) or not ips.issubset(have_ips):
        return False
    expires = getattr(leaf, "not_valid_after_utc", None)
    if expires is None:  # pragma: no cover - older cryptography
        expires = leaf.not_valid_after.replace(tzinfo=dt.timezone.utc)
    return expires - RENEW_MARGIN > dt.datetime.now(dt.timezone.utc)


def _issue_leaf(cfg: Settings, ca_cert, ca_key, dns: set[str], ips: set[str]):
    x509, hashes, serialization, ec, NameOID = _crypto()
    now = dt.datetime.now(dt.timezone.utc)
    key = ec.generate_private_key(ec.SECP256R1())
    hostname = host_name().lower()

    ordered_dns = [name for name in ("localhost", hostname, f"{hostname}.local") if name in dns]
    ordered_dns += sorted(dns.difference(ordered_dns))
    ordered_ips = sorted(ips, key=lambda value: (value not in {"127.0.0.1", local_ip()}, value))

    san = [x509.DNSName(name) for name in ordered_dns] + [
        x509.IPAddress(ipaddress.ip_address(value)) for value in ordered_ips
    ]

    leaf = (
        x509.CertificateBuilder()
        .subject_name(
            x509.Name(
                [
                    x509.NameAttribute(NameOID.COMMON_NAME, LEAF_COMMON_NAME.format(host=hostname)),
                    x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Thoth Notes"),
                ]
            )
        )
        .issuer_name(ca_cert.subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=5))
        .not_valid_after(now + dt.timedelta(days=max(1, int(cfg.leaf_valid_days))))
        .add_extension(x509.SubjectAlternativeName(san), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.ExtendedKeyUsage([x509.oid.ExtendedKeyUsageOID.SERVER_AUTH]), critical=False
        )
        .add_extension(
            x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False
        )
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_cert.public_key()), critical=False
        )
        .sign(ca_key, hashes.SHA256())
    )

    _write(
        cfg.key_file,
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ),
        secret=True,
    )
    _write(
        cfg.cert_file,
        leaf.public_bytes(serialization.Encoding.PEM) + ca_cert.public_bytes(serialization.Encoding.PEM),
    )
    return leaf


def ensure_certificates(
    cfg: Settings | None = None,
    extra_hosts: list[str] | None = None,
    force: bool = False,
) -> dict[str, object]:
    """Makes sure the laptop has a CA and a certificate that matches its address.

    Re-issuing keeps the existing CA, so the iPad never installs a second
    profile after a DHCP change or a reinstall. ``force`` throws the CA away too.
    """
    config = cfg or global_settings
    if config.tunneled:
        return {
            "created": False,
            "skipped": "public-url",
            "reason": "A public HTTPS address is configured, so no local certificate is needed.",
            "baseUrl": config.base_url,
        }

    dns, ips = wanted_names(extra_hosts)
    existing = None if force else _load_ca(config)
    ca_created = existing is None
    reissued = False

    if existing is None:
        ca_cert, ca_key = _make_ca(config)
    else:
        ca_cert, ca_key = existing

    if ca_created or not _leaf_is_usable(config, dns, ips):
        _issue_leaf(config, ca_cert, ca_key, dns, ips)
        reissued = True

    config.save()
    return {
        "created": ca_created or reissued,
        "caCreated": ca_created,
        "reissued": reissued,
        "cert": str(config.cert_file),
        "key": str(config.key_file),
        "ca": str(config.ca_file),
        "fingerprint": fingerprint_of(config),
        "hostname": f"{host_name().lower()}.local",
        "ips": sorted(ips),
        "dns": sorted(dns),
        "baseUrl": config.base_url,
        "setupUrl": f"{config.base_url}/setup",
    }


def expires_at(cfg: Settings | None = None) -> str:
    """Leaf expiry as an ISO date, or an empty string when there is no leaf."""
    config = cfg or global_settings
    found = _leaf_names(config)
    if not found:
        return ""
    leaf = found[0]
    value = getattr(leaf, "not_valid_after_utc", None) or leaf.not_valid_after.replace(
        tzinfo=dt.timezone.utc
    )
    return value.date().isoformat()


def server_hostname() -> str:
    return socket.gethostname()
