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
| Equations | MathLive editing with a categorised symbol keyboard, KaTeX display, stored as LaTeX, movable, resizable, editable, duplicated, aligned, sized |
| Graphs | Several functions with colour/width/dash/visibility, zoom, pan, reset, custom ranges, grid, axes, labels, legend, points, roots, intersections, extrema, derivative and tangent overlays — inserted as a live object, not a picture |
| Tables | Editable rows, columns, cells, header row, alignment and text size |
| Calculator | Scientific keyboard with degrees/radians, a running history, copy, insert as a number or as a formatted equation |
| Units | Length, area, volume, mass, force, pressure, energy and temperature with SI-exact factors, selectable precision, copy and insert |
| Geometry | Grid and 15° snapping for the shape tools, optional shape recognition on freehand ink with an accept/reject bar |
| Appearance | Light, dark and system themes through CSS variables; paper stays white so exports print as written |
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

1. Push the repository to GitHub (it lives at `https://github.com/JupomIII/thoth-notes`).
2. **Settings → Pages → Source: GitHub Actions**.

   Live app: **https://jupomiii.github.io/thoth-notes/**
3. The workflow (`.github/workflows/deploy.yml`) type-checks, tests, builds, adds
   a `404.html` SPA fallback and publishes `frontend/dist` on every push to
   `main`.
4. Open `https://<user>.github.io/<repo>/` in Safari on the iPad → Share →
   **Add to Home Screen**.

GitHub Pages hosts the **application only**. Notes, tokens and certificates are
never committed (`backend/storage/` and `*.db` are ignored).

## 3. Install the Windows server

Double-click **`run.bat`** in the repository root: it installs on first run, starts
the server in its own window and opens `https://localhost:8443/` in the browser.

Or run the two scripts directly:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1
```

`install-windows.ps1` finds Python 3.12+, creates `backend\.venv`, installs
`requirements.txt`, initialises the SQLite database, creates the pairing token,
generates a local CA + server certificate, optionally builds the frontend so the
server can host the app itself, and (when elevated) adds a firewall rule for TCP
8443 restricted to the Private profile and `LocalSubnet`.

The server prints a six-character pairing code, a pairing link, the certificate
path and the HTTPS address. The long-lived token stays in
`storage\pairing-token.txt` and is never printed. All data lives in
`backend\storage`:

```
storage/
  thoth.db                 SQLite archive (WAL)
  blobs/<asset-id>         original PDFs and images
  backups/thoth-*.zip      rotating archives (newest 7)
  certs/server-cert.pem    server certificate + CA chain
  certs/thoth-rootCA.cer   install this on the iPad
  pairing-token.txt        keep private
  pair-secret              keep private (derives the rotating pairing codes)
  config.json              port, CORS origins, rotation
```

Nothing is exposed to the public Internet: the server binds to the LAN, rejects
non-private client IPs and requires the token on every `/api` route except
`/api/health` and the pairing exchange.

## 4. Pair the iPad

Install and trust the profile first. The iPad downloads it from the laptop — it
is not emailed, AirDropped or copied by hand.

`run.bat` opens a **pairing page in your browser** at
`https://localhost:8443/pair` (the server itself runs minimised in the
background). That page lists the steps in order and shows the setup address, the
QR code and the code itself.

1. On the iPad, open the **setup page**: `https://<laptop-address>:8443/setup`.
   Accept Safari's warning once (*Show Details → Visit this Website*).
2. Tap **Download the profile**, then install it: Settings → General → VPN &
   Device Management → *Thoth Notes Local CA* → Install, and enable it under
   Settings → General → About → **Certificate Trust Settings**.
3. Scan the QR code on the pairing page with the iPad camera and tap the banner.
   The app opens on the sync screen, exchanges the code for the token, stores it
   and runs a first sync.

The same page has a **copy-link** button and the code in case it is typed by hand
under **Cloud → Synchronisation**. Codes change every thirty minutes and never
contain the token; the pairing page is only served to the laptop itself.

**HTTPS is not optional.** An installed PWA on GitHub Pages is an HTTPS origin;
Safari blocks plain `http://` API calls as mixed content. The installer's
locally-trusted certificate is the practical fix for a LAN-only server. See
[`docs/IPAD-SETUP.md`](docs/IPAD-SETUP.md) for the two-tap install, the exact
wording of every Settings screen, and the **certificate-free option**: run the
server behind a trusted address (`tailscale serve`, Cloudflare Tunnel) with
`-PublicUrl` and no profile is needed on the iPad at all.

Browsers cannot browse the local network — Safari exposes no service-discovery
API — so the QR code (or the copied link) is what replaces typing an address.

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

## 7. Academic tools

All of it runs from bundled code: MathLive, KaTeX, mathjs and pdf-lib are hoisted
into their own lazy chunks, so a notebook without equations or graphs never
downloads them and handwriting keeps priority on the main thread.

| Tool | Where | What is stored |
| --- | --- | --- |
| Equation editor | Header **Insert → Equation**, ⌘E | LaTeX source, position, width, size, colour, alignment, label |
| Graph | **Insert → Graph**, ⌘G | Functions with colour/width/dash/visibility, ranges, grid and axis flags, points, title |
| Table | **Insert → Table** | Cells, column widths, row heights, border colour, header flag, alignment, size |
| Calculator | Header **Calculator** | Nothing (history is per session) |
| Unit converter | Calculator → **Convert** | Nothing |

Objects on the page behave like ink objects for the tools that matter: tap with
the **Select objects** tool to edit, duplicate, copy or delete; drag to move; drag
the corner handle to resize; double-click to reopen the editor. They are painted
into thumbnails, PNG exports and PDF pages at export resolution.

Math is never evaluated with `eval`. Expressions run through the `mathjs/number`
build with an `x` scope, and anything that leaves the finite range returns null so
a curve simply breaks instead of drawing nonsense.

## 8. Drawing engine notes

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

## 9. Testing

See [`docs/TESTING.md`](docs/TESTING.md) for the exact commands, results and the
hardware checklist. Summary of what was executed for this build:

* `frontend`: strict `tsc` typecheck, `vite build` with service worker, 19 Vitest
  unit tests (geometry, stroke splitting, expression parsing and graph analysis).
* `backend`: 29 pytest tests (auth, push/pull, conflict preservation, tombstones,
  asset round-trip, validation, backup round-trip, corrupted backup rejection,
  rotation).
* Live server smoke test over real TLS: certificate generation, `/api/health`,
  token-protected `/api/status` (401 without token), push, static app serving and
  attachment upload/download.

Not verified here: anything requiring physical hardware — Apple Pencil pressure
and tilt curves, palm rejection on glass, sustained frame rate, Safari PWA
installation, iPadOS certificate trust UI. Those are listed as a manual
checklist.

## 10. Known limitations

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
* **Geometry toolkit** covers straight line, rectangle, ellipse and triangle as
  vector shapes, with grid/angle snapping and optional shape recognition for
  those four. A ruler, protractor, compass, arbitrary polygon, dimension line and
  coordinate-point object are **not** implemented; the engineering and isometric
  papers cover the layout need, not the measuring instruments.
* **Shape recognition** runs after a freehand stroke and always asks first; the
  original ink is only replaced when the proposal is accepted.
* **Equations on canvas** (thumbnails, PNG, PDF) are painted by a LaTeX layout
  routine built on KaTeX's parse tree rather than by KaTeX's DOM renderer, so a
  handful of exotic constructs may space slightly differently than on screen.
  The stored LaTeX is unchanged and re-edits perfectly.
* **Table cells are edited in the table editor**, opened by double-clicking the
  table or with **Edit**; cells are not typed into directly on the page.
* **Dark mode themes the chrome only.** Paper stays white so exports and prints
  match what was written; there is no per-page paper colour beyond the existing
  paper picker.
* **New object kinds across devices** travel as ordinary sync records, but the
  round trip was not exercised against a running Windows server in this build —
  only the record shapes, the backend's accepted kinds and the backup entries
  were verified.

## 11. Scripts reference

| Script | Purpose |
| --- | --- |
| `run.bat` | double-click launcher: installs if needed, starts the server, opens the app |
| `scripts/install-windows.ps1` | venv, dependencies, DB, token, certificate, optional frontend build, firewall |
| `scripts/start-server.ps1` | starts Uvicorn (HTTPS when a certificate exists) |
| `scripts/pair.ps1` | prints a fresh pairing code and copies a pairing link |
| `scripts/backup-now.ps1` | writes a ZIP archive immediately |
| `scripts/allow-firewall.ps1` | adds the private-network firewall rule (admin) |
| `python -m app.cli status` | counts, paths, TLS state |
| `python -m app.cli pair` | prints the current code, link and server address |
| `python -m app.cli token` | prints the pairing token |
| `python -m app.cli setup` | prints the setup address, pairing link, code and fingerprint |
| `python -m app.cli public-url <url>` | uses a trusted tunnel address and drops the local certificate |
| `python -m app.cli cert --force` | regenerates the CA too (the iPad installs a new profile) |

## 12. Security model

* Private-network binding plus a middleware that rejects non-private client IPs.
* Constant-time pairing-token comparison on every data route.
* Pairing uses a six-character code derived from a local secret and a ten-minute
  window; it is single-purpose, rate limited and never contains the token.
* CORS limited to same-origin, `http://localhost:5173` and
  `https://*.github.io`; edit `allow_origin_regex` in `storage/config.json` to
  restrict further.
* The token lives in `storage/pairing-token.txt` (gitignored) and in the iPad's
  IndexedDB; it is never logged by the app or committed.
* The certificate and CA are generated on the machine and never leave it. Keys are
  ECDSA P-256, the CA is limited to signing server certificates (`path_length=0`)
  and its private key stays in `storage/certs/ca-key.pem` so the server can renew
  its own certificate without the iPad installing a second profile.
* The trust profile is downloaded by the iPad from the laptop at `/setup`; it is
  never transferred through a third party.

Personal use only. No analytics, no telemetry, no third-party requests at
runtime.
