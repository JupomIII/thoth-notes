# Getting Thoth Notes onto the iPad

Three things happen here: the app goes on the Home Screen, the iPad learns to
trust your laptop, and the two pair. Nothing is emailed, AirDropped or copied by
hand — the trust profile is downloaded by the iPad from the laptop itself.

## 1. Install the app

1. Push the repository to GitHub with `frontend/` where
   `.github/workflows/deploy.yml` expects it.
2. Repository → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main`. The workflow type-checks, runs the tests, builds and publishes
   `frontend/dist` to `https://<user>.github.io/<repo>/`.
4. Open that URL in **Safari** on the iPad, wait for the first load, then
   Share → **Add to Home Screen**.
5. Launch it from the icon and check it opens offline: Airplane Mode, close the
   app from the switcher, reopen it. The library must still be there.

`frontend/vite.config.ts` uses `base: './'`, so the same build also works at a
custom domain root. `dist/404.html` is a copy of `index.html` because the app
uses hash routing.

## 2. Run the laptop server

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1
```

Or just double-click **`run.bat`**, which installs on first run, starts the server
in its own window and opens the pairing page in your browser.

The server window prints, in this order:

```
  iPad address   : https://192.168.2.179:8443/
  Pairing code   : K7QM4P          (changes every 30 min)
  Pairing page   : https://localhost:8443/pair   (open on the laptop)

  First time on the iPad - nothing to send or copy:
    1. Open https://192.168.2.179:8443/setup in Safari on the iPad
    2. Tap 'Download the profile', install it in Settings, then enable it
       under Certificate Trust Settings
    3. Scan the pairing QR code on the laptop's pairing page
  Certificate    : 3F:9A:...:B1
```

If the iPad cannot reach the laptop, run `scripts\allow-firewall.ps1` from an
**Administrator** PowerShell window. The rule is limited to the Private profile
and `LocalSubnet`; the server itself also rejects any client outside private
address ranges.

## 3. Trust the laptop, on the iPad

Open the **setup page** printed above (`https://<address>:8443/setup`) in Safari
on the iPad. It is served by your laptop and it walks through the four taps:

1. **Accept the warning once.** Safari warns because the laptop signs its own
   certificate: *Show Details → Visit this Website*.
2. **Download the profile.** The button on that page serves the CA straight from
   the laptop. Safari says *Profile Downloaded*. Nothing was transferred by you.
3. **Install it.** Settings → General → VPN & Device Management → *Thoth Notes
   Local CA* → Install. Then Settings → General → About → **Certificate Trust
   Settings** → switch *Thoth Notes Local CA* on. Both taps are required; iOS
   installs profiles without trusting them by default.
4. **Come back and pair.** Reload the setup page — no warning this time — then use
   the app's sync screen.

The page shows the certificate fingerprint and expiry so you can confirm you are
looking at the right laptop.

### Why a certificate exists at all

GitHub Pages is an HTTPS origin and Safari refuses `http://` requests from it as
mixed content; there is no override, not even for an installed web app. Measured
on this stack, such a request fails in about 6 ms with `TypeError: Load failed`
and never reaches the laptop, and Safari has no exemption for private addresses.
So the laptop must speak HTTPS with a certificate the iPad accepts. Apple does not let a
web page install a certificate silently, which is why the last two taps in
Settings are unavoidable **for a purely local server**.

What changed from earlier versions:

* The profile is **downloaded from the laptop**, never sent as a file.
* The CA key now stays in `backend\storage\certs\ca-key.pem`, so the server can
  re-issue its own certificate when the LAN address changes — the profile on the
  iPad keeps working. Reinstalling never produces a second profile.
* Keys are ECDSA P-256, the CA may only sign server certificates, and the server
  certificate is valid for 397 days and renewed automatically in the last week.

## 4. Pair

**Scan.** The pairing page on the laptop (`https://localhost:8443/pair`) shows a
QR code. Point the iPad camera at it, tap the banner: the app opens on the sync
screen with the address and code already filled in and pairs itself. The link
carries only the short-lived code, never the token.

**Type.** App → **Synchronisation** → *Set up this iPad*. Step 1 has a
**Check again** button that calls the laptop and tells you whether the
certificate is trusted yet; step 2 takes the six characters from the server
window. Codes change every thirty minutes and the previous one is accepted for
one window.

The token is stored only in the iPad's IndexedDB, is never shown in full (dots
only), never appears in a URL and is never logged. **Forget this laptop** removes
it. The sync screen also shows the destination: laptop name, notes folder and how
much is stored there.

## 5. If you would rather not install a certificate

A trusted public address removes the need for a profile completely. Any of these
works because Safari already trusts the address:

**Tailscale (free for personal use).** Install Tailscale on the laptop and the
iPad, sign both into the same tailnet, then on the laptop:

```powershell
tailscale serve --bg 8443
```

Tailscale prints an address such as `https://jps-laptop.tailnet-name.ts.net`.
Give it to the server once:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1 -PublicUrl https://jps-laptop.tailnet-name.ts.net
```

The server then speaks plain HTTP behind the tunnel, no certificate is generated,
`/setup` says there is nothing to install, and the pairing link points at the
trusted address. Nothing needs to be installed on the iPad.

**Cloudflare Tunnel** works the same way: point the tunnel at
`http://localhost:8443` and pass its `https://…` hostname with `-PublicUrl`.

Store or clear the address at any time:

```powershell
cd backend
.\.venv\Scripts\python.exe -m app.cli public-url https://your-address.ts.net
.\.venv\Scripts\python.exe -m app.cli public-url            # back to the local certificate
```

Keep the server on the private network either way: it rejects clients outside
private address ranges, and every `/api` route except health and pairing needs
the token.

## 6. Updating

* **Frontend**: push to `main`; the new service worker downloads in the
  background and the app offers *Reload*. Notes are untouched.
* **Backend**: `git pull`, then re-run `scripts\install-windows.ps1` — the virtual
  environment and `backend\storage` are preserved. The certificate is re-issued
  only if the machine's addresses changed, and it keeps the same CA.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Setup page will not open at all | Laptop asleep, wrong network, or firewall | Wake the laptop, check both are on the same Wi-Fi, run `scripts\allow-firewall.ps1` |
| Warning returns after trusting | Profile installed but not enabled | Settings → General → About → Certificate Trust Settings |
| "Check again" says no answer | Certificate not trusted yet, or server stopped | Finish step 3, then start the server window |
| Paired, then *offline* | DHCP gave the laptop a new address | The certificate is re-issued on the next start; re-open the setup page and pair again with the new address |
| New laptop, same iPad | Fingerprint changed | Install the new profile; the old one can be removed under VPN & Device Management |
