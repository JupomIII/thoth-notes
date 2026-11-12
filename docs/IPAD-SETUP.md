# Installing on iPad and trusting the local certificate

## 1. Deploy the frontend to GitHub Pages

GitHub Pages only ever hosts the **application build**. Notes live in the iPad's
IndexedDB and, after a sync, on your Windows laptop. Nothing user-generated is
committed to the repository.

1. Push the repository to GitHub with `frontend/` at the path shown in
   `.github/workflows/deploy.yml`.
2. Repository → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main` (or run the workflow manually). The workflow type-checks,
   runs the unit tests, builds and publishes `frontend/dist`.
4. Note the URL: `https://<user>.github.io/<repo>/`.

`frontend/vite.config.ts` uses `base: './'`, so the same build works at a
project sub-path and at a custom domain root. `dist/404.html` is a copy of
`index.html` because the app uses hash routing.

## 2. Add to the Home Screen

1. Open the Pages URL in **Safari** on the iPad (not in an embedded browser).
2. Wait for the first load to finish; the service worker precaches the app shell
   (16 files, ~2.5 MB, including the PDF renderer worker).
3. Share → **Add to Home Screen**.
4. Launch from the icon. It opens standalone, without Safari chrome.
5. Verify offline behaviour: enable Airplane Mode, close the app from the app
   switcher, reopen it. The library and notebooks must still open.

The app requests persistent storage on first launch and shows the result in
Settings → Storage. If iPadOS declines, export a backup regularly: Safari may
evict site data under storage pressure.

## 3. Run the Windows server

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1
```

The installer prints:

* the pairing token (also in `backend\storage\pairing-token.txt`),
* the certificate file `backend\storage\certs\thoth-rootCA.cer`,
* the HTTPS address, normally `https://<computer-name>.local:8443/`.

If the iPad cannot reach the server, run `scripts\allow-firewall.ps1` from an
**Administrator** PowerShell window. The rule is limited to the Private profile
and `LocalSubnet`; the server itself also rejects any client that is not on a
private address range.

## 4. Trust the certificate on iPadOS

A self-signed certificate must be installed *and* explicitly trusted, otherwise
Safari shows an interstitial and `fetch()` from an installed PWA fails.

1. Move `thoth-rootCA.cer` to the iPad (AirDrop, iCloud Drive, or the Files app).
2. Tap the file → *Profile Downloaded*.
3. **Settings → General → VPN & Device Management → Thoth Notes Local CA → Install**.
4. **Settings → General → About → Certificate Trust Settings** → enable
   *Thoth Notes Local CA*.
5. Open `https://<computer-name>.local:8443/` in Safari. There must be **no**
   warning page; a padlock confirms the chain is trusted.

If your network has no working mDNS resolution for `.local`, use the IP address
instead. The certificate contains both the hostname and the LAN IP as Subject
Alternative Names. IP addresses can change with DHCP, so prefer the hostname or
add a DHCP reservation.

> Rotating the certificate (a new install with `--force`) requires installing the
> new CA again, because a fresh CA is generated each time.

## 5. Pair the iPad

In the app: **Cloud icon → Windows server**.

* Server address: `https://<computer-name>.local:8443` (the app adds `https://`
  if you omit the scheme).
* Pairing token: paste from the server window.
* **Test connection** should answer *"<machine> · protocol v1"*.
* **Save connection**, then **Sync now**.

The token is stored in IndexedDB on the iPad and only sent to that address. It
is never logged by the app.

## Why HTTPS is mandatory

GitHub Pages is an HTTPS origin. Browsers block `http://` requests from an HTTPS
page as mixed content — Safari does this for installed PWAs with no override.
There is no client-side workaround: the server must speak TLS with a
certificate the iPad trusts.

Two practical arrangements:

1. **GitHub Pages app + HTTPS API** (above). Works offline and from anywhere;
   cross-origin requests are allowed for `https://*.github.io` by the server's
   CORS regex (`allow_origin_regex` in `backend/storage/config.json`).
2. **Server-hosted app**. If the installer builds the frontend, the server
   serves it at `https://<host>:8443/` — same origin as the API, no CORS at all,
   and no dependency on GitHub. Add that page to the Home Screen of the iPad too
   if you want a second, LAN-only install. Both installs share one origin only
   if the origin matches; IndexedDB is per origin, so pick one as your main
   writing app.

`http://` is still usable for a desktop browser on the same machine when no
certificate exists (the server prints a warning), but never for the iPad PWA.

## Updating

* **Frontend**: push to `main`. The new service worker downloads in the
  background; the app shows a *Reload* prompt. No note data is touched.
* **Backend**: `git pull`, then re-run `scripts\install-windows.ps1`
  (it reuses the virtual environment and preserves `backend\storage`).
