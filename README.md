# Thoth Notes

Offline-first handwriting notebooks for iPad, written for Apple Pencil, with a
local Windows sync server owned by you. No accounts, no subscriptions, no cloud,
no App Store.

* **iPad app** — installable PWA (React + TypeScript + Vite + Tailwind) hosted on
  GitHub Pages. Works with the network off, reads and writes IndexedDB.
* **Drawing engine** — custom Canvas 2D + Pointer Events engine with pressure,
  tilt, viewport culling, partial erasing, lasso transforms and vector storage.
* **Windows server** — FastAPI + SQLite + Pydantic, run from PowerShell, reachable
  only over the local network with a pairing token and a locally trusted
  certificate.
* **Sync** — incremental, bidirectional, tombstone-aware and conflict-preserving.
* **Backups** — checksummed ZIP archives with rotation, on iPad and on Windows.

```
Apple Pencil ─▶ drawing engine ─▶ IndexedDB ─▶ outbox ─▶ HTTPS (LAN) ─▶ FastAPI
                                                                          │
                                                            SQLite + blobs + backups
```

## Feature map

Everything listed here is implemented; there are no decorative controls.

| Area | Implemented |
| --- | --- |
| Drawing tools | Fountain pen, ballpoint, pencil, highlighter, stroke/partial eraser, lasso select, text, image, line, rectangle, ellipse, arrow |
| Pen input | `pointerType` detection, pressure-sensitive width, tilt-sensitive pencil width, coalesced high-frequency events, `pointercancel` recovery |
| Gestures | One-finger pan (toggleable), two-finger pinch zoom, wheel/trackpad zoom on desktop, pencil always wins over touch |
| Editing | Undo/redo (bounded), clear selection, copy, paste, move, resize, delete, select all |
| Paper | Blank, ruled, grid, dotted, engineering graph, isometric; A4, US Letter, infinite; change paper without touching ink |
| Notebooks | Folders, notebooks, page ordering, duplication (page and notebook), favourites, archive, deletion with tombstones |
| PDF | Import multi-page PDFs as pages, handwriting over the original, per-page annotation, PDF export onto the untouched source page, PNG export |
| Storage | Immediate IndexedDB persistence, 120 ms write-behind batching, in-flight stroke recovery, quota error surfacing, persistent-storage request, versioned schema with migrations |
| Sync | Incremental push/pull, offline queue, retries, manual and automatic sync, deterministic conflicts with a recovery UI, attachment transfer |
| Backup | Local ZIP export/import with SHA-256 manifest, Windows rotating archives, create/list/download, validation on import |
| PWA | Installable, standalone, full offline app shell, prompted update flow, offline indicator, safe-area layout |

## Repository layout

```
frontend/        React PWA (see docs/ARCHITECTURE.md)
backend/         FastAPI server, tests, storage (gitignored)
shared/schemas/  JSON Schema for the sync envelope
scripts/         PowerShell install / start / backup / firewall helpers
docs/            Architecture, iPad setup, sync protocol, testing
deploy           .github/workflows/deploy.yml → GitHub Pages
```

## 1. Run the frontend locally

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
npm run typecheck
npm test             # vitest: geometry + partial-erase splits
npm run build        # dist/ with service worker
```

## 2. Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "Thoth Notes"
git branch -M main
git remote add origin git@github.com:<user>/<repo>.git
git push -u origin main
```

1. Push the repository to GitHub.
2. **Settings → Pages → Source: GitHub Actions**.
3. The workflow (`.github/workflows/deploy.yml`) type-checks, tests, builds, adds
   a `404.html` SPA fallback and publishes `frontend/dist` on every push to
   `main`.
4. Open `https://<user>.github.io/<repo>/` in Safari on the iPad → Share →
   **Add to Home Screen**.

GitHub Pages hosts the **application only**. Notes, tokens and certificates are
never committed (`backend/storage/` and `*.db` are ignored).

## 3. Install the Windows server

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1
```

`install-windows.ps1` finds Python 3.12+, creates `backend\.venv`, installs
`requirements.txt`, initialises the SQLite database, creates the pairing token,
generates a local CA + server certificate, optionally builds the frontend so the
server can host the app itself, and (when elevated) adds a firewall rule for TCP
8443 restricted to the Private profile and `LocalSubnet`.

The server prints the token, the certificate path and the HTTPS address. All data
lives in `backend\storage`:

```
storage/
  thoth.db                 SQLite archive (WAL)
  blobs/<asset-id>         original PDFs and images
  backups/thoth-*.zip      rotating archives (newest 7)
  certs/server-cert.pem    server certificate + CA chain
  certs/thoth-rootCA.cer   install this on the iPad
  pairing-token.txt        keep private
  config.json              port, CORS origins, rotation
```

Nothing is exposed to the public Internet: the server binds to the LAN, rejects
non-private client IPs and requires the token on every `/api` route except
`/api/health`.

## 4. Pair the iPad

Install and trust `thoth-rootCA.cer` first (Settings → General → VPN & Device
Management → Install, then Settings → General → About → Certificate Trust
Settings). Then in the app: **Cloud → Windows server**, enter
`https://<computer-name>.local:8443` and paste the token, **Test connection**,
**Save**, **Sync now**.

**HTTPS is not optional.** An installed PWA on GitHub Pages is an HTTPS origin;
Safari blocks plain `http://` API calls as mixed content. The installer's
locally-trusted certificate is the practical fix. Full walkthrough:
[`docs/IPAD-SETUP.md`](docs/IPAD-SETUP.md).

## 5. The intended daily workflow

1. Write on the iPad with Apple Pencil; every stroke is saved locally within a
   fraction of a second.
2. Close the app, turn off Wi-Fi, reopen it — the library, pages and ink are all
   there from the service-worker cache and IndexedDB.
3. When the laptop is on the same network, the app syncs automatically every
   45 seconds (or with **Sync now**).
4. The Windows copy holds every notebook, page, vector stroke, PDF and image in
   SQLite and `storage\blobs`, with rotating ZIP backups.

## 6. Backups

* **iPad → ZIP**: Backup screen → *Export local backup*. Includes JSON metadata,
  vector strokes, images, original PDFs and a manifest with SHA-256 checksums.
* **Restore**: Backup screen → *Restore from ZIP*. Validated entry by entry;
  records are merged by id and only replaced when newer, so importing twice
  creates no duplicates, and tombstones are respected.
* **Windows**: `scripts\backup-now.ps1`, or *Create backup on Windows* from the
  app. Automatic backups run at startup and every 24 hours; the newest seven are
  kept.

## 7. Drawing engine notes

* Strokes are vector records (`StrokePoint[]` with pressure, tilt, timestamp).
  They are never flattened for storage.
* Three canvases (paper / ink / live). Input only repaints the live layer; a
  finished stroke is appended to the ink layer in one paint. Full repaints happen
  on undo, erase, selection transforms and view changes, culled to the visible
  document rectangle.
* Pressure drives perfect-freehand thinning; tilt widens the pencil nib. Safari
  does not expose pencil azimuth, so directional shading is not implemented.
* Partial erasing splits a stroke into the surviving runs (new ids, same style)
  and records one undo step for the whole drag.
* Panning/zooming redraws vectors at the new scale, so ink stays crisp at any
  zoom instead of scaling a bitmap.

## 8. Testing

See [`docs/TESTING.md`](docs/TESTING.md) for the exact commands, results and the
hardware checklist. Summary of what was executed for this build:

* `frontend`: strict `tsc` typecheck, `vite build` with service worker, 9 Vitest
  unit tests.
* `backend`: 12 pytest tests (auth, push/pull, conflict preservation, tombstones,
  asset round-trip, validation, backup round-trip, corrupted backup rejection,
  rotation).
* Live server smoke test over real TLS: certificate generation, `/api/health`,
  token-protected `/api/status` (401 without token), push, static app serving and
  attachment upload/download.

Not verified here: anything requiring physical hardware — Apple Pencil pressure
and tilt curves, palm rejection on glass, sustained frame rate, Safari PWA
installation, iPadOS certificate trust UI. Those are listed as a manual
checklist.

## 9. Known limitations

* **Sync runs while the app is open.** iOS suspends background JavaScript; sync
  also triggers on launch, when the app becomes visible and when the network
  returns.
* **Palm rejection is practical, not perfect.** Touch input is suppressed while a
  pen pointer is active, which covers normal use; Safari exposes no contact-size
  data, so a palm that lands before the pencil touches down can still pan.
* **No two-finger rotation.** It is optional in the brief and conflicts with fast
  pinch-zoom during writing.
* **Search covers notebook titles only.** Vector ink is not OCR'd, so there is no
  full-text handwriting search.
* **PDF export** copies the original page and draws the annotation layer as a
  high-resolution transparent raster on top. The source PDF stays untouched in
  storage; annotations remain vectors in the database.
* **Copy/paste is in-app** (a rendered ink clipboard), not the system pasteboard.
* **Infinite pages** are unbounded for writing and panning, but export uses the
  content bounding box.

## 10. Scripts reference

| Script | Purpose |
| --- | --- |
| `scripts/install-windows.ps1` | venv, dependencies, DB, token, certificate, optional frontend build, firewall |
| `scripts/start-server.ps1` | starts Uvicorn (HTTPS when a certificate exists) |
| `scripts/backup-now.ps1` | writes a ZIP archive immediately |
| `scripts/allow-firewall.ps1` | adds the private-network firewall rule (admin) |
| `python -m app.cli status` | counts, paths, TLS state |
| `python -m app.cli token` | prints the pairing token |
| `python -m app.cli cert --force` | regenerates the certificate (re-trust on iPad) |

## 11. Security model

* Private-network binding plus a middleware that rejects non-private client IPs.
* Constant-time pairing-token comparison on every data route.
* CORS limited to same-origin, `http://localhost:5173` and
  `https://*.github.io`; edit `allow_origin_regex` in `storage/config.json` to
  restrict further.
* The token lives in `storage/pairing-token.txt` (gitignored) and in the iPad's
  IndexedDB; it is never logged by the app or committed.
* The certificate and CA are generated on the machine and never leave it.

Personal use only. No analytics, no telemetry, no third-party requests at
runtime.
