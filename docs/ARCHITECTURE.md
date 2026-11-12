# Architecture

Three independent components, in the order they matter for data safety.

## 1. iPad application (`frontend/`)

Static PWA. React 18 + TypeScript (strict) + Vite + Tailwind, Lucide icons,
`vite-plugin-pwa` (Workbox), Dexie 4 over IndexedDB, perfect-freehand, pdf.js,
pdf-lib.

```
src/
  app/            hash router (no dependency)
  components/     screens: library, notebook, editor, sync, backup, settings
  drawing/
    engine.ts     pointer input, layers, tools, selection, undo/redo
    stroke.ts     perfect-freehand outline + canvas painting (strokeRender.ts)
    paper.ts      procedural paper backgrounds
    gestures      one-finger pan / two-finger pinch inside engine.ts
    history.ts    bounded undo/redo stack
    renderPage.ts off-screen renderer used by export + thumbnails
    textRender.ts shared text wrapping for canvas and exports
  storage/
    db.ts         Dexie schema + versioned migrations (v1 → v3)
    repo.ts       record helpers, tombstones, cascades
    pageStore.ts  buffered write-behind persistence adapter
    backup.ts     ZIP export/import with checksums
    assets.ts     attachment storage
  sync/           protocol types, HTTP client, orchestration, status store
  pdf/            pdf.js loader + page rasteriser
  export/         PNG and PDF writers, PDF import
  lib/            ids, geometry, hashing, formatting
```

**Layers.** Three stacked canvases: paper (grid/lines/PDF page), ink (committed
content), live (in-flight stroke, lasso trail, selection box). Panning redraws
paper+ink with vector data at the current zoom, so strokes stay sharp; pointer
moves only touch the live layer. A committed stroke is appended to the model and
painted once — no full-page repaint per input event. Undo, erase, selection
transforms and view changes are the only full repaints, and they are culled to
the visible document rectangle using cached stroke bounds.

**Input.** Pointer Events only. Pen and mouse draw; touch never draws. One finger
pans (configurable), two fingers pinch-zoom. `pointercancel` commits a stroke if
it has enough points, otherwise discards it. Coalesced events are consumed for
high-frequency Apple Pencil sampling. Palm rejection suppresses touch input
while a pen pointer is down and for 40 ms after it lifts.

**Persistence.** Every committed stroke goes through `PageWriteBuffer`, a
120 ms write-behind queue that batches strokes into one IndexedDB transaction and
marks them in the sync outbox. In-flight strokes are snapshotted into `drafts`
every 1.5 s and recovered on reopen. Page thumbnails are stored locally only.

## 2. Windows server (`backend/`)

FastAPI + Uvicorn + SQLite (stdlib `sqlite3`, WAL) + Pydantic v2. No ORM, no
Docker, no external services.

```
app/
  main.py          app factory, TLS, static hosting, automatic backups
  config.py        paths/config/token under backend/storage
  security.py      private-network guard + constant-time token check
  database/db.py   schema, sequence counter, row mapping
  models/schemas.py Pydantic request/response models
  sync/engine.py   merge, conflicts, incremental cursor
  services/assets.py attachment files on disk
  backup/manager.py ZIP create/rotate/list/export/import with validation
  certs.py         local CA + server certificate (cryptography)
  cli.py           init/token/cert/backup/status
  api/routes.py    REST surface
```

`objects` is the single table for every synced kind, plus `conflicts`,
`asset_files`, `counters` and `meta`. Each accepted mutation bumps one counter
row, so `seq` is a total order used as the incremental sync cursor.

The server can serve the built frontend (`frontend/dist`) at its own origin,
which removes CORS and mixed-content problems entirely and gives the iPad a
LAN-only install option.

## 3. Shared contract (`shared/schemas/`)

`sync.schema.json` documents the record envelope and both push/pull payloads.
The Python models and the TypeScript types mirror it; the merge rule is
implemented twice with the same comparison, and both implementations are covered
by tests.

## Data flow

```
Apple Pencil ─▶ engine (vector strokes) ─▶ PageWriteBuffer ─▶ IndexedDB
                                                     │
                                                     └─▶ outbox ─▶ HTTPS ─▶ FastAPI
                                                                              │
                                                       SQLite objects ◀───────┘
                                                       storage/blobs (PDF/image bytes)
                                                       storage/backups (rotating ZIPs)
```

Reading is always local: the app opens from the service-worker cache and reads
IndexedDB. The server is only required for moving data between devices.

## Why this split

* Drawing never awaits storage or network on the input path.
* Storage knows nothing about rendering or sync.
* Sync only understands envelopes and opaque JSON payloads, so new object types
  do not require protocol changes (`kind` is the only switch).
* Conflict resolution is deterministic on both sides, so recovery does not
  depend on which device reconnects first.
