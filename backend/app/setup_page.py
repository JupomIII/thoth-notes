"""The page the iPad opens while it learns to trust this laptop.

Everything the iPad needs is served from the laptop itself: no file is copied
across, nothing is emailed. The page is plain HTML with no dependencies so it
loads even when the certificate is not trusted yet.
"""

from __future__ import annotations

from html import escape
from string import Template

from . import certs

_PAGE = Template(
    """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Connect this iPad · Thoth Notes</title>
<style>
  :root { color-scheme: light; --paper:#faf8f4; --raised:#fffdfa; --sunken:#f2eee7;
          --ink:#1f1d1a; --soft:#4a463f; --muted:#7c766b; --faint:#a8a196;
          --line:#e2dcf0; --line-strong:#d3ccbe; --accent:#4a6156; --accent-soft:#e7ede9;
          --danger:#9b4b3f; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink);
         font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         -webkit-text-size-adjust: 100%; }
  main { max-width: 640px; margin: 0 auto; padding: 44px 22px 72px; }
  .eyebrow { font-size: 11.5px; letter-spacing: .12em; text-transform: uppercase;
             color: var(--muted); margin: 0 0 10px; }
  h1 { font-family: Georgia, 'Times New Roman', serif; font-weight: 400;
       font-size: 30px; line-height: 1.2; margin: 0 0 10px; }
  .lede { color: var(--muted); line-height: 1.55; margin: 0 0 26px; font-size: 15px; }
  .card { background: var(--raised); border: 1px solid var(--line); border-radius: 16px;
          padding: 8px 20px; box-shadow: 0 1px 2px rgba(31,29,26,.05); }
  .device { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: baseline;
            padding: 14px 0 16px; border-bottom: 1px solid var(--line); }
  .device strong { font-family: Georgia, serif; font-weight: 400; font-size: 18px; }
  .addr { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px;
          color: var(--muted); word-break: break-all; }
  ol.steps { list-style: none; margin: 0; padding: 0; }
  ol.steps > li { display: grid; grid-template-columns: 30px 1fr; gap: 4px 14px;
                  padding: 18px 0; border-bottom: 1px solid var(--line); }
  ol.steps > li:last-child { border-bottom: 0; }
  .num { width: 26px; height: 26px; border-radius: 50%; background: var(--sunken);
         border: 1px solid var(--line-strong); color: var(--soft); font-size: 13px;
         display: flex; align-items: center; justify-content: center; }
  .step-title { font-size: 15px; margin: 2px 0 4px; color: var(--ink); }
  .step-body { font-size: 13.5px; line-height: 1.6; color: var(--muted); margin: 0; }
  .step-body b, .step-body strong { color: var(--soft); font-weight: 600; }
  .step-body code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                    font-size: 12px; background: var(--sunken); border-radius: 5px;
                    padding: 1px 5px; }
  .row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; align-items: center; }
  .btn { display: inline-flex; align-items: center; height: 42px; padding: 0 16px;
         border-radius: 10px; border: 1px solid var(--line-strong); background: var(--raised);
         color: var(--ink); font: inherit; font-size: 14px; text-decoration: none; cursor: pointer; }
  .primary { background: var(--accent); border-color: var(--accent); color: #fffdfa; }
  .btn[disabled] { opacity: .45; }
  .status { font-size: 13px; color: var(--muted); }
  .status.ok { color: var(--accent); }
  .status.bad { color: var(--danger); }
  .meta { margin-top: 26px; font-size: 12px; color: var(--faint); line-height: 1.7; }
  .meta code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px;
               word-break: break-all; }
  .note { margin-top: 18px; border-radius: 12px; background: var(--accent-soft);
          border: 1px solid rgba(74,97,86,.18); padding: 12px 14px; font-size: 13px;
          line-height: 1.55; color: var(--accent); }
  @media (prefers-color-scheme: dark) {
    :root { color-scheme: dark; --paper:#181715; --raised:#211f1d; --sunken:#121110;
            --ink:#eeeae2; --soft:#d2ccc2; --muted:#9c968b; --faint:#746e65;
            --line:#34322e; --line-strong:#48443e; --accent:#8aad9b; --accent-soft:#262f2a; }
  }
</style>
</head>
<body>
<main>
  <p class="eyebrow">Thoth Notes</p>
  <h1>$heading</h1>
  <p class="lede">$lede</p>

  <div class="card">
    <div class="device">
      <strong>$machine</strong>
      <span class="addr">$address</span>
    </div>

    <ol class="steps">
$steps
    </ol>
  </div>

  <div class="note">$note</div>

  <p class="meta">$meta</p>
</main>
<script>
(function () {
  var button = document.getElementById('check');
  var status = document.getElementById('status');
  if (!button || !status) return;
  button.addEventListener('click', async function () {
    button.disabled = true;
    status.className = 'status';
    status.textContent = 'Contacting the laptop…';
    try {
      var response = await fetch('/api/health', { cache: 'no-store' });
      var data = await response.json();
      status.className = 'status ok';
      status.textContent = data.deviceName + ' answered · protocol v' + data.version + ' · ' +
        new Date(data.time).toLocaleTimeString();
    } catch (error) {
      status.className = 'status bad';
      status.textContent = 'No answer. Check that the laptop is awake and on the same network.';
    } finally {
      button.disabled = false;
    }
  });
})();
</script>
</body>
</html>
"""
)

_STEP = Template("""      <li>
        <span class="num">$number</span>
        <div>
          <p class="step-title">$title</p>
          <p class="step-body">$body</p>
          $extra
        </div>
      </li>""")


def _trust_steps(cfg) -> str:
    steps = [
        (
            "1",
            "Accept this laptop once",
            "Safari is showing a warning because this laptop signs its own "
            "certificate. Tap <b>Show Details</b>, then <b>Visit this Website</b>. "
            "That warning disappears for good after step 3.",
            "",
        ),
        (
            "2",
            "Download the profile from the laptop",
            "The profile comes straight from this page: there is no file to send, "
            "copy or email. Safari will say <b>Profile Downloaded</b>.",
            '<div class="row"><a class="btn primary" href="/ca" download="thoth-rootCA.cer">'
            "Download the profile</a></div>",
        ),
        (
            "3",
            "Install it in Settings",
            "<b>Settings → General → VPN &amp; Device Management</b> → tap "
            "<b>Thoth Notes Local CA</b> → <b>Install</b>. Then open "
            "<b>Settings → General → About → Certificate Trust Settings</b> and turn on "
            "<b>Thoth Notes Local CA</b>. Both taps matter: installing alone is not enough.",
            "",
        ),
        (
            "4",
            "Come back and pair",
            "Reload this page: the warning is gone. Then open Thoth Notes, go to "
            "<b>Synchronisation</b> and scan the pairing QR code shown on the laptop. "
            "The app checks the certificate before it sends anything.",
            '<div class="row">'
            '<button class="btn" id="check" type="button">Test the connection</button>'
            '<span class="status" id="status"></span></div>',
        ),
    ]
    return "\n".join(
        _STEP.substitute(number=number, title=title, body=body, extra=extra)
        for number, title, body, extra in steps
    )


def _tunnel_steps() -> str:
    steps = [
        (
            "1",
            "No certificate to install",
            "This laptop is published behind a trusted HTTPS address, so Safari "
            "already accepts it. Skip straight to pairing.",
            "",
        ),
        (
            "2",
            "Pair",
            "Open Thoth Notes → <b>Synchronisation</b> → type the address above, or scan "
            "the pairing QR code shown on the laptop. Nothing needs to be installed on "
            "the iPad.",
            '<div class="row">'
            '<button class="btn" id="check" type="button">Test the connection</button>'
            '<span class="status" id="status"></span></div>',
        ),
    ]
    return "\n".join(
        _STEP.substitute(number=number, title=title, body=body, extra=extra)
        for number, title, body, extra in steps
    )


def render_setup_page(cfg, machine: str) -> str:
    tunneled = cfg.tunneled
    fingerprint = certs.fingerprint_of(cfg)
    expiry = certs.expires_at(cfg)

    if tunneled:
        heading = "Pair this iPad in one step"
        lede = (
            "This laptop serves Thoth Notes through a trusted address, so there is "
            "no certificate to install on the iPad."
        )
        note = (
            "Only devices that know the pairing code can join. The code changes every "
            f"{cfg.pair_code_minutes} minutes and never contains the sync token."
        )
        meta = f"Public address <code>{escape(cfg.base_url)}</code>"
        steps = _tunnel_steps()
    else:
        heading = "Connect this iPad to this laptop"
        lede = (
            "Four taps, all on this iPad. The certificate is downloaded from the "
            "laptop over your own network; it is never copied through email, AirDrop "
            "or a cloud drive."
        )
        note = (
            "Why a certificate at all: iOS refuses to let an installed web app call a "
            "plain <code>http://</code> address, so the laptop speaks HTTPS. The profile "
            "you install only tells this iPad to trust <em>this</em> laptop."
        )
        bits = [f"Certificate fingerprint <code>{escape(fingerprint)}</code>"]
        if expiry:
            bits.append(f"valid until {escape(expiry)}")
        bits.append("the private key never leaves this machine")
        meta = " · ".join(bits)
        steps = _trust_steps(cfg)

    return _PAGE.substitute(
        heading=escape(heading),
        lede=lede,
        machine=escape(machine),
        address=escape(str(cfg.base_url)),
        steps=steps,
        note=note,
        meta=meta,
    )
