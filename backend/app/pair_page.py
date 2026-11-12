"""The pairing page the laptop browser opens.

Everything the iPad needs to join lives here: a QR code that pairs on scan, the
code in case it is typed, and the certificate download. It is only served to the
laptop itself, so the code never travels further than this screen.
"""

from __future__ import annotations

from string import Template

from . import pairing

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
  h1 { font-family: Georgia, 'Times New Roman', serif; font-size: 30px; margin: 0 0 6px; }
  .lede { margin: 0 0 24px; color: #6d665c; line-height: 1.5; }
  .card { background: #fffdfa; border: 1px solid #e5ded1; border-radius: 16px; padding: 24px;
          box-shadow: 0 1px 2px rgba(31, 29, 26, 0.06); }
  .qr { display: block; margin: 4px auto 14px; width: 300px; height: 300px; }
  .code { text-align: center; font-size: 14px; color: #6d665c; margin: 0; }
  .code strong { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 26px;
                 letter-spacing: 0.3em; color: #1f1d1a; }
  .addr { text-align: center; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 12.5px; color: #6d665c; margin: 8px 0 0; word-break: break-all; }
  .hint { text-align: center; color: #8a8378; font-size: 12.5px; margin: 12px 0 0; }
  ol { margin: 24px 0 0; padding-left: 20px; color: #3d3830; line-height: 1.6; }
  ol a { color: #4a6156; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; }
  .btn { display: inline-flex; align-items: center; height: 42px; padding: 0 16px; border-radius: 10px;
         border: 1px solid #e5ded1; background: #fffdfa; color: #1f1d1a; font-size: 14px;
         text-decoration: none; cursor: pointer; font-family: inherit; }
  .primary { background: #4a6156; border-color: #4a6156; color: #fffdfa; }
  footer { margin-top: 28px; color: #8a8378; font-size: 12.5px; text-align: center; line-height: 1.5; }
</style>
</head>
<body>
<main>
  <h1>Pair your iPad</h1>
  <p class="lede">Point the iPad camera at this code and tap the banner that appears: the app opens
  already paired, nothing to type.</p>

  <div class="card">
    <img class="qr" id="qr" src="/api/pair/qr" alt="Pairing QR code">
    <p class="code">Code <strong id="code">$code</strong></p>
    <p class="addr" id="addr">$server_url</p>
    <p class="hint" id="left">New code in $minutes min</p>
  </div>

  <ol>
    <li><strong>Scan</strong> the code with the iPad camera — or open the pairing link below on the iPad.</li>
    <li>If Safari warns about the certificate, open <a href="/ca">the certificate</a> on the iPad first:
      Settings → General → VPN &amp; Device Management → Install, then Certificate Trust Settings.</li>
    <li>In Safari, Share → <strong>Add to Home Screen</strong> for the app-like install.</li>
  </ol>

  <div class="actions">
    <button class="btn" id="copy" type="button">Copy pairing link</button>
    <a class="btn primary" href="/">Open the notes app</a>
  </div>

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
    return _PAGE.substitute(
        code=pairing.current_code(cfg),
        server_url=cfg.base_url,
        minutes=cfg.pair_code_minutes,
        expires=pairing.seconds_left(cfg),
        link=pairing.pairing_link(cfg),
    )
