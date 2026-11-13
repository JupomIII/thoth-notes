# Testing and verification

This document records what was executed for this build, the results, and what
must be checked by hand on hardware. Nothing below is extrapolated: unexecuted
checks are listed as such.

## Automated checks (executed)

### Frontend

```
cd frontend
npx tsc -b            # strict TypeScript, no errors
npx vitest run        # 3 files, 19 tests, all passing
npm run build         # vite build + PWA generateSW, success
```

* Type checking covers every source file with `strict`, `noUnusedLocals`,
  `noUnusedParameters` and `noUncheckedIndexedAccess`.
* Unit tests cover: stroke bounds, point-to-segment distance, lasso polygon
  containment, Douglas–Peucker simplification, anchored zoom maths and zoom
  clamping; partial-erase splitting (two surviving runs, fully erased stroke,
  long wavy stroke); expression normalisation, polynomial/trigonometric/piecewise
  evaluation, syntax errors, out-of-domain values, roots, intersections, extrema
  and the numerical derivative.
* The production build precaches 40 files (~4.3 MB) including the PDF.js worker,
  and emits `sw.js` + `manifest.webmanifest`. Main bundle is 258 kB gzipped;
  MathLive, KaTeX, mathjs and pdf-lib are separate chunks loaded on demand.

### Backend

```
cd backend
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements.txt
./.venv/Scripts/python.exe -m pytest -q
# 23 passed
```

Coverage of the executed tests:

| Test | What it proves |
| --- | --- |
| `test_requires_token` | `/api/status` is 401 without a token; `/api/health` is public |
| `test_rejects_bad_token` | Wrong token is rejected |
| `test_push_and_pull_roundtrip` | Push accepted, record visible in changes, cursor prevents re-sending |
| `test_older_write_is_preserved_as_conflict` | Older incoming write does not overwrite; both payloads returned |
| `test_newer_write_wins_and_bumps_sequence` | Newer write applies, server timestamp increases, incremental pull sees it |
| `test_tombstone_propagates` | Deletion tombstones travel through the change feed |
| `test_asset_upload_and_download` | Binary attachment round-trip |
| `test_rejects_oversized_kind` | Unknown `kind` fails validation (422) |
| `test_backup_export_import_roundtrip` | ZIP contains manifest counts/checksums, data present, re-import adds no duplicates |
| `test_corrupted_backup_is_rejected` | Tampered file fails checksum validation |
| `test_rotation_keeps_newest` | Backup rotation prunes to the configured count |
| `test_invalid_zip_rejected` | Non-ZIP upload fails cleanly |

### Live server smoke test (executed)

Started the real Uvicorn server with a generated certificate in a temporary data
directory and exercised it with `curl` over TLS:

* `app.cli init` produced a token, a server certificate and a DER root CA.
* `GET /api/health` → `{"ok":true,...,"version":1}`.
* `GET /api/status` with token → counts, cursor, `tls: true`, LAN base URL.
* `GET /api/status` without token → `401`.
* `POST /api/sync/push` → record accepted, cursor advanced.
* `GET /` → `200 text/html` (bundled frontend served by the backend).
* `PUT` + `GET /api/sync/assets/{id}` → 10-byte payload returned unchanged.

## Manual checklist for the iPad (not executed here)

This environment has no iPad, Apple Pencil or iPadOS Safari, so the following
must be verified by hand. Each item states what to look for.

1. **Install**: Pages URL in Safari → Add to Home Screen → launches without
   browser chrome, correct safe-area padding in portrait and landscape.
2. **Pressure**: with the fountain pen, slow light strokes must be visibly
   thinner than firm strokes; the curve should feel continuous, not stepped.
3. **Tilt**: with the pencil, lay the tip flatter — the nib should widen. Safari
   provides `tiltX`/`tiltY` but no azimuth, so no directional shading is expected.
4. **Palm rejection**: rest the palm while writing; ink must not appear from the
   palm. A palm landing before the pencil touches down may pan the page.
5. **Latency**: write a full page quickly; the in-flight stroke must track the
   tip. If it lags, note the device model and the number of strokes on the page.
6. **Long session**: 20+ minutes of continuous writing with autosave running;
   check memory pressure in Safari's Web Inspector if available.
7. **Undo/redo**: draw, erase (both modes), move a lasso selection, then undo
   through all of it; redo must restore identical geometry.
8. **Refresh**: reload mid-notebook; the page must reopen with all strokes and
   any in-flight stroke recovered from the draft store.
9. **Offline reopen**: Airplane Mode, kill the app from the switcher, reopen —
   library and notebooks must be fully usable.
10. **PWA update**: push a new commit, reopen the app — the reload prompt appears
    and applying it keeps all notes.
11. **Certificate**: install the CA, enable trust, open the HTTPS address with no
    warning, then pair and sync.
12. **Sync interruption**: start a sync, disable Wi-Fi mid-transfer; the app must
    report an error, keep the queue, and complete on the next attempt.
13. **Laptop shutdown during sync**: power off / sleep the laptop mid-sync; iPad
    must remain usable and retry later.
14. **Conflict**: edit the same notebook title on both sides while offline, then
    sync; both versions must appear on the iPad conflict list and *Keep this
    iPad*/*Keep Windows* must produce the expected result.
15. **Backup restore**: export a ZIP, delete a notebook, restore — the notebook
    returns with strokes, text and images, without duplicates.

Record the iPad model, iPadOS version and observed behaviour alongside any
failure; the engine has no device-specific branches beyond `pointerType` and DPR
clamping, so most issues will be Safari API limitations rather than layout.

## Performance expectations (not measured here)

The design avoids full-page repaints during input and culls strokes to the
visible rectangle, but **no frame-rate claim is made**: this build was not
profiled on iPad hardware. If a specific page feels slow, the useful measurements
are point counts per stroke, stroke count per page, and whether the PDF layer is
being re-rasterised during input (it is debounced to 220 ms after a zoom settles).

## This build — academic tools (executed in Chromium, dev server)

| Check | Result |
| --- | --- |
| Equation inserted from the editor | Object appears on the page, rendered with KaTeX, action bar offers Edit/Duplicate/Copy/Delete |
| Equation survives a reload | Reloaded page shows the same equation object with its KaTeX rendering and stored LaTeX |
| Symbol keyboard categories | Basic/Greek/Calculus/Algebra/Trigonometry/Linear algebra/Matrices render real KaTeX previews |
| Graph inserted and reopened | Two functions (x², sin x) plotted; reopening the object restores both expressions and redraws the curves |
| Graph analysis | f(1) = 1.0000, f′(1) = 2.0000, tangent y = 2.00x − 1.00, root x = 0, minimum (0, 0), intersections (0.00, 0.00) and (0.88, 0.77) |
| Scientific calculator | 2 + 3 × 4 = 14, history entry recorded, "As equation" opens the equation editor prefilled with `2+3 	imes 4 = 14` |
| Unit converter | Length category defaults to 1 mm = 0.1000 cm; categories and precision controls present |
| Table inserted | 3 × 3 table object with nine cells on the page, editable through the table editor |
| Theme switching | Light and dark tokens swap on the document root; dark chrome background `rgb(24,23,21)`, light `rgb(250,248,244)` |
| PDF export | Ran to completion with no console errors after loading pdf-lib and the typesetter |
| Console | No errors or failed requests during the session; only Vite HMR and a Canvas2D `getImageData` advisory |

Not executed: the sync/backup round trip for the three new kinds against a
running Windows server (record shapes and backend kinds were checked instead),
and every hardware check below.

### Extra manual checks for the new tools on iPad

1. Open the equation editor, type with the on-screen MathLive keyboard and with
   the hardware keyboard; confirm the caret behaves with an Apple Pencil tapped
   into the field.
2. Drag and resize an equation and a graph with a finger; confirm they land where
   the finger lifted at 50 % and 200 % zoom.
3. Graph panel: pan inside the preview with one finger, pinch to zoom, confirm the
   handwriting layer behind is unaffected after closing the panel.
4. Calculator and converter sheets: confirm the numeric keypad does not obscure
   the result field when the software keyboard is open.
5. Export a notebook containing an equation, a graph and a table to PDF and check
   the printed sizes against the page.

