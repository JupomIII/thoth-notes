import pytest

from app import certs
from app.config import Settings


@pytest.fixture
def cfg(tmp_path, monkeypatch) -> Settings:
    """Settings bound to a throwaway data directory for the whole test."""
    monkeypatch.setenv("THOTH_DATA_DIR", str(tmp_path))
    return Settings().load()


def test_setup_page_explains_the_flow_without_sending_files(bare_client):
    response = bare_client.get("/setup")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    body = response.text
    assert "Connect this iPad" in body
    assert 'href="/ca"' in body
    assert "Download the profile" in body
    assert "Certificate Trust Settings" in body
    # Order matters: trust first, then pair; and nothing is transferred by hand.
    assert body.index("Accept this laptop once") < body.index("Download the profile")
    assert "nothing to send" in body.lower() or "never copied" in body.lower()


def test_certificate_download_is_an_attachment(bare_client, cfg):
    certs.ensure_certificates(cfg)
    response = bare_client.get("/ca")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-x509-ca-cert")
    assert "attachment" in response.headers["content-disposition"]
    assert len(response.content) > 300


def test_ca_key_is_kept_so_a_profile_survives_an_address_change(cfg):
    first = certs.ensure_certificates(cfg)
    assert first["caCreated"] is True
    assert cfg.ca_key_file.exists(), "the CA key must stay on the laptop to re-issue leaves"

    second = certs.ensure_certificates(cfg, extra_hosts=["10.9.8.7"])
    assert second["reissued"] is True
    assert second["fingerprint"] == first["fingerprint"], "the trust anchor must not change"
    assert "10.9.8.7" in second["ips"]

    third = certs.ensure_certificates(cfg, extra_hosts=["10.9.8.7"])
    assert third["reissued"] is False, "a matching certificate is reused"


def test_forcing_a_new_ca_changes_the_fingerprint(cfg):
    first = certs.ensure_certificates(cfg)
    forced = certs.ensure_certificates(cfg, force=True)
    assert forced["fingerprint"] != first["fingerprint"]
    assert forced["caCreated"] is True


def test_public_url_removes_the_need_for_a_local_certificate(cfg):
    cfg.public_url = "https://jps-laptop.example-ts.net/"
    assert cfg.tunneled is True
    assert cfg.tls is False
    assert cfg.base_url == "https://jps-laptop.example-ts.net"
    assert cfg.setup_url == "https://jps-laptop.example-ts.net/setup"

    info = certs.ensure_certificates(cfg)
    assert info["created"] is False
    assert info["skipped"] == "public-url"
    assert not cfg.cert_file.exists()


def test_certificate_covers_both_hostname_and_addresses(cfg):
    info = certs.ensure_certificates(cfg)
    assert "localhost" in set(info["dns"])
    assert "127.0.0.1" in set(info["ips"])
    assert info["fingerprint"].count(":") == 31
    assert certs.expires_at(cfg), "an expiry date is reported to the setup page"
