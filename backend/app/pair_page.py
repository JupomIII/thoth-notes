"""The pairing page the laptop browser opens.

It answers one question — what do I do on the iPad next — with the two addresses
the iPad needs, in order: the setup page (trust this laptop) and the pairing QR
code. It is served to the laptop itself only, so the code never travels further
than this screen.
"""

from __future__ import annotations

from string import Template

from . import pairing


def _steps(cfg) -> str:
    if cfg.tunneled:
        return """
    <li><strong>Open Thoth Notes → Synchronisation</strong> on the iPad and type the
      address below, or scan the QR code.</li>
    <li><strong>Enter the code</strong> shown on this page. There is no certificate to
      install: this server uses a trusted address.</li>"""
    return f"""
    <li><strong>On the iPad, open the setup page</strong>
      <a href="{cfg.setup_url}">{cfg.setup_url}</a> in Safari. It downloads the trust
      profile straight from this laptop — nothing is emailed, AirDropped or copied.</li>
    <li><strong>Install the profile</strong>: Settings → General → VPN &amp; Device
      Management → <em>Thoth Notes Local CA</em> → Install, then enable it under
      Settings → General → About → <em>Certificate Trust Settings</em>. Both taps
      matter.</li>
    <li><strong>Scan this QR code</strong> with the iPad camera and tap the banner. The
      app opens on the sync screen already carrying the code.</li>"""


_PAGE = Template(
    """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pair your iPad · Thoth Notes</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         background: #faf8f4; color: #1f1d1a; }
  main { max-width: 720px; margin: 0 auto; padding: 40px 20px 64px; }
  h1 { font-family: Georgia, 'Times New Roman', serif; font-weight: 400; font-size: 30px; margin: 0 0 6px; }
  .lede { margin: 0 0 24px; color: #6d665c; line-height: 1.55; font-size: 15px; }
  .card { background: #fffdfa; border: 1px solid #e5ded1; border-radius: 16px; padding: 24px;
          box-shadow: 0 1px 2px rgba(31, 29, 26, 0.06); }
  .qr { display: block; margin: 4px auto 14px; width: 300px; height: 300px; }
  .code { text-align: center; font-size: 14px; color: #6d665c; margin: 0; }
  .code strong { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 26px;
                 letter-spacing: 0.3em; color: #1f1d1a; }
  .addr { text-align: center; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 12.5px; color: #6d665c; margin: 8px 0 0; word-break: break-all; }
  .hint { text-align: center; color: #8a8378; font-size: 12.5px; margin: 12px 0 0; }
  h2 { font-family: Georgia, serif; font-weight: 400; font-size: 17px; margin: 30px 0 8px; }
  ol { margin: 0; padding-left: 20px; color: #3d3830; line-height: 1.65; font-size: 14px; }
  ol li { margin-bottom: 8px; }
  ol a { color: #4a6156; word-break: break-all; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; }
  .btn { display: inline-flex; align-items: center; height: 42px; padding: 0 16px; border-radius: 10px;
         border: 1px solid #e5ded1; background: #fffdfa; color: #1f1d1a; font-size: 14px;
         text-decoration: none; cursor: pointer; font-family: inherit; }
  .primary { background: #4a6156; border-color: #4a6156; color: #fffdfa; }
  .why { margin-top: 22px; border-radius: 12px; background: #f2eee7; padding: 12px 14px;
         font-size: 12.5px; line-height: 1.6; color: #4a463f; }
  footer { margin-top: 28px; color: #8a8378; font-size: 12.5px; text-align: center; line-height: 1.5; }
</style>
</head>
<body>
<main>
  <h1>Pair your iPad</h1>
  <p class="lede">$lede</p>

  <h2>What to do on the iPad</h2>
  <ol>$steps
    <li>In Safari, Share → <strong>Add to Home Screen</strong> once the app opens.</li>
  </ol>

  <h2>Scan to pair</h2>
  <div class="card">
    <img class="qr" id="qr" src="/api/pair/qr" alt="Pairing QR code">
    <p class="code">Code <strong id="code">$code</strong></p>
    <p class="addr" id="addr">$server_url</p>
    <p class="hint" id="left">New code in $minutes min</p>
  </div>

  <div class="actions">
    <button class="btn" id="copy" type="button">Copy pairing link</button>
    <a class="btn primary" href="$setup_url" target="_blank" rel="noreferrer">Open the iPad setup page</a>
  </div>

  <div class="why">$why</div>

  <footer>Codes change every $minutes minutes and never contain the pairing token.
  This page only opens on the laptop itself.</footer>
</main>
<script>
(function () {
  var link = '$link';
  var remaining = $expires;
  var left = document.getElementById('left');

  function paint() {
    if (remaining <= 0) { left.textContent = 'Refreshing…'; return; }
    var minutes = Math.max(1, Math.round(remaining / 60));
    left.textContent = 'New code in ' + minutes + ' min';
  }
  setInterval(function () { remaining = Math.max(0, remaining - 1); paint(); }, 1000);
  paint();

  async function refresh() {
    try {
      var response = await fetch('/api/pair/link', { cache: 'no-store' });
      if (!response.ok) { return; }
      var data = await response.json();
      document.getElementById('code').textContent = data.code;
      document.getElementById('addr').textContent = data.serverUrl;
      document.getElementById('qr').src = '/api/pair/qr?t=' + Date.now();
      link = data.link;
      remaining = data.expiresIn;
      paint();
    } catch (error) { /* the laptop is restarting; the next tick retries */ }
  }
  setInterval(refresh, 60000);

  document.getElementById('copy').addEventListener('click', function () {
    var button = document.getElementById('copy');
    navigator.clipboard.writeText(link).then(function () {
      button.textContent = 'Copied';
      setTimeout(function () { button.textContent = 'Copy pairing link'; }, 1600);
    });
  });
})();
</script>
</body>
</html>
"""
)


def render_pair_page(cfg) -> str:
    if cfg.tunneled:
        lede = (
            "This laptop is published behind a trusted address, so the iPad needs no "
            "certificate: open the app, sync to the address below and enter the code."
        )
        why = (
            "Because the address is signed by a public certificate authority, Safari "
            "accepts it as-is. Nothing is installed on the iPad."
        )
    else:
        lede = (
            "Two things happen on the iPad: it trusts this laptop once, then it pairs. "
            "Both come from this laptop over your own network."
        )
        why = (
            "Why the profile: iOS will not let an installed web app talk to a plain "
            "<code>http://</code> address, so this server uses HTTPS with a certificate "
            "it signs itself. The profile tells the iPad to trust this one machine — the "
            "private key never leaves it, and the profile is downloaded from the setup "
            "page rather than sent through email or AirDrop."
        )
    return _PAGE.substitute(
        lede=lede,
        steps=_steps(cfg),
        why=why,
        code=pairing.current_code(cfg),
        server_url=cfg.base_url,
        setup_url=cfg.setup_url,
        minutes=cfg.pair_code_minutes,
        expires=pairing.seconds_left(cfg),
        link=pairing.pairing_link(cfg),
    )
