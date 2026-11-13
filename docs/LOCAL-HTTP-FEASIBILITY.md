# Certificate-free local sync: feasibility result

**Question.** Can the Thoth Notes app — served from GitHub Pages over HTTPS and
installed on the iPad Home Screen — talk to a plain `http://` server on the
Windows laptop over the local Wi-Fi, with no certificate, no tunnel and no third
party involved?

**Answer: no.** The browser blocks the request before it leaves the page. Both
tested browsers refuse it, Safari included by design, and there is no web API
that turns the block off. Sync was therefore **not** implemented on top of it.

## What was built for the test

A throwaway diagnostic pair, deliberately outside the sync product:

| Piece | Where | What it does |
| --- | --- | --- |
| Plain HTTP probe server | `backend/app/feasibility.py` | FastAPI on `0.0.0.0:8787`, **no TLS, no certificate, no token**; `GET /health`, `GET`/`POST /sync/test`, permissive CORS, `Access-Control-Allow-Private-Network: true` on preflight, and a small index page for opening from the iPad |
| Temporary card in the app | `frontend/src/components/LocalHttpProbe.tsx` | In **Cloud → Synchronisation**, bottom of the page: enter the probe address, *Run the test*, and it reports the browser's own wording for what happened; *Copy probe link* for pasting into iPad Safari |

Nothing in the probe touches IndexedDB, the sync queue, the certificate store or
the existing HTTPS server. The real server and its pages are unchanged.

### Running it on Windows

```powershell
cd backend
.\.venv\Scripts\python.exe -m app.feasibility
```

The window prints the address to use:

```
  LAN address : http://192.168.2.179:8787/health
  Same laptop : http://127.0.0.1:8787/health
  No TLS, no certificate, no token. Ctrl+C to stop.
```

`curl http://192.168.2.179:8787/health` returns:

```json
{"ok":true,"service":"thoth-notes-feasibility","device":"JPS_LAPTOP",
 "lanIp":"192.168.2.179","port":8787,"time":"2026-11-13T00:34:07+00:00",
 "note":"Plain HTTP, no certificate, no token. Reachability test only."}
```

with `access-control-allow-origin: *` and
`access-control-allow-private-network: true`.

## What the test showed

| # | Page origin | Target | Result |
| --- | --- | --- | --- |
| 1 | `http://localhost:5173` (dev, plain HTTP) | `http://192.168.2.179:8787/health` | **Reached the laptop in 11 ms.** CORS fine, LAN path fine, no prompt. |
| 2 | `https://jupomiii.github.io` (deployed app, Chrome 130) | same | **No request left the page — 6 ms, `TypeError: Failed to fetch`**, and the `no-cors` retry failed identically. |

Row 1 proves the server, the firewall rule and the Wi-Fi are not the problem.
Row 2 isolated the single cause.

Chromium's console, verbatim:

```
Mixed Content: The page at 'https://jupomiii.github.io/thoth-notes/?v=probe#/sync'
was loaded over HTTPS, but requested an insecure resource
'http://192.168.2.179:8787/health'. This request has been blocked;
the content must be served over HTTPS.
```

The card in the app shows the same conclusion in one line: *No request left the
page (6 ms, Failed to fetch)*, followed by the explanation and the Safari
wording to expect.

The 6 ms and the identical failure of the CORS and opaque requests matter: the
mixed-content check runs **before** any socket is opened, DNS lookup or CORS
negotiation. The request never reaches the laptop, so nothing configured on the
server side can help — not CORS, not the private-network header, not another port.

## Safari and iPadOS specifically

Safari is stricter than Chromium here, not looser:

* WebKit applies the same mixed-content rule to `fetch`, `XMLHttpRequest`,
  `<script>`, `<img>` and WebSocket, with no exemption for private addresses.
  Requesting `http://192.168.x.x` from an HTTPS page is blockable content.
* WebKit's Local Network Access work (the permission that would let a public page
  ask before touching the LAN) **does not exist in Safari**; only Chromium 142+
  implements it, and only behind a permission prompt. So the Chromium exemption
  path is not available on the iPad.
* In Safari 18 Apple removed the last loopback allowance: a request to
  `http://127.0.0.1` from an HTTPS page is now blocked too (WebKit bug 279249).
  Older behaviour is not something to build on.
* Safari's Web Inspector console reports it as, verbatim:

  ```
  [blocked] The page at <https://…> requested insecure content from
  <http://192.168.1.5:8787/health>. This content was blocked and must be
  served over HTTPS.
  ```

  and the page's JavaScript sees a rejected promise, `TypeError: Load failed`.
  There is no status code, no CORS error and no network entry — that absence is
  the signature of the block.

### Doing the test on the iPad (one minute)

1. `python -m app.feasibility` in `backend` on the laptop.
2. On the iPad, open the installed Thoth Notes app → **Cloud → Synchronisation**,
   scroll to **Temporary · local HTTP test**, enter `http://<printed address>:8787`,
   tap **Run the test**.
3. Expected: *No request left the page … TypeError: Load failed*.
4. Optional control: tap **Copy probe link**, paste it in Safari's address bar and
   load it. It opens, showing *Local HTTP probe is running*. That contrast is the
   whole finding: **the device can reach the laptop; the HTTPS page may not.**

If step 4 also fails, the cause is the network (laptop asleep, different Wi-Fi,
firewall) rather than the browser.

## Why the constraint set cannot be satisfied

Every configuration that would let an HTTPS page call a local server needs one of:

1. **A certificate the iPad trusts** — the current design. Excluded by "no
   manually installed certificates".
2. **A trusted HTTPS address for the laptop** — Tailscale, Cloudflare Tunnel, a
   reverse proxy. Excluded by "no third-party services".
3. **Serving the app itself over HTTP from the laptop** — Excluded by "GitHub
   Pages HTTPS frontend must remain unchanged", and an HTTP origin would lose the
   service worker and Home Screen install anyway.

There is no fourth option: the block is enforced by WebKit's mixed-content rule
and no web page can opt out of it. Nothing that can be added to this project's
code changes that, which is why the second task was not started.

## If the position changes later

* The existing certificate flow already works and is documented in
  [`IPAD-SETUP.md`](IPAD-SETUP.md); it needs one profile install and nothing else.
* If a trusted address ever becomes acceptable, the server already supports it:
  `python -m app.cli public-url https://<address>` drops the certificate
  requirement entirely.
* The probe card is temporary. Removing the feature means deleting
  `frontend/src/components/LocalHttpProbe.tsx`, its import and one element in
  `frontend/src/components/SyncScreen.tsx`, plus `backend/app/feasibility.py` and
  `backend/tests/test_feasibility.py`. Nothing else refers to them.

## Honest limits of this report

The deployed-app test was run in Chromium 130 on this laptop, not on the iPad:
no iPad hardware is attached here. Safari's behaviour above is documented from
WebKit's own bug tracker and engine rules, and the card is deployed so the same
test can be run on the iPad in a minute. Step 4's control (opening the probe page
directly in iPad Safari) is the part that can only be done on the device.
