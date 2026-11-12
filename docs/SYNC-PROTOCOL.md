# Sync protocol (v1)

The iPad and the Windows server exchange **records**, never whole notebooks.
A record is one notebook, folder, page, stroke, text block, image placement or
attachment, wrapped in the same envelope on both sides.

```json
{
  "kind": "stroke",
  "id": "6f0c2a1e-...",
  "data": { "...": "full entity including envelope fields" },
  "createdAt": 1731430000000,
  "updatedAt": 1731430055000,
  "version": 12,
  "deviceId": "b6d1...",
  "deletedAt": null
}
```

Kinds: `folder`, `notebook`, `page`, `stroke`, `text`, `image`, `asset`.
The JSON Schema lives in `shared/schemas/sync.schema.json`.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Protocol version and machine name (no token required, no data) |
| GET | `/api/status` | Counts, cursor, devices, TLS state |
| POST | `/api/sync/push` | Upsert a batch of records (max 500) |
| GET | `/api/sync/changes?since=<seq>&limit=<n>` | Incremental pull ordered by sequence |
| PUT | `/api/sync/assets/{id}` | Upload attachment bytes (raw body) |
| GET | `/api/sync/assets/{id}` | Download attachment bytes |
| POST | `/api/backup/create` | Write a ZIP backup now |
| GET | `/api/backup/list` | List archives |
| GET | `/api/backup/download/{name}` | Download one archive |
| GET | `/api/backup/export` | Generate and stream an archive |
| POST | `/api/backup/import` | Validate and merge a ZIP archive |
| GET | `/api/conflicts` | Server-side conflict log metadata |

| POST | `/api/pair` | Exchange a six-character pairing code for the token |
| GET | `/api/pair/link` | Pairing code, deep link and seconds left (laptop only) |
| GET | `/api/pair/qr` | The pairing link as an SVG QR code (laptop only) |
| GET | `/pair` | Browser pairing page with the QR code (laptop only) |
| GET | `/ca` | Root certificate download for the iPad |

All `/api` routes except `/api/health`, `/api/pair`, `/api/pair/link` and
`/api/pair/qr` require `X-Thoth-Token`
with the pairing token from `backend/storage/pairing-token.txt`. Requests from
non-private IP addresses are rejected with `403`.

The pairing page and its two feed endpoints are additionally limited to the
laptop's own addresses (`127.0.0.1`, `::1`, the machine's LAN IP), so the QR code
is never visible to another device on the network.

`/api/pair` accepts `{code, deviceName}` and answers `{token, serverUrl,
deviceName}`. The code is `HMAC(pair-secret, thirty-minute window)` truncated to six
characters, so it expires without server state, the previous window is accepted
for clock skew, and eight wrong attempts per address block pairing until the
window turns over. It is not the token and cannot be used for anything else.

## Cursor

Every accepted mutation increments a single SQLite counter and stores the value
in `objects.seq`. A client stores the last cursor it pulled and asks for
`changes?since=<cursor>`. Records that arrive identical to what the server holds
do not get a new sequence, so a client re-pushing its own data cannot cause a
pull loop.

## Merge rule

Both sides apply the same deterministic comparison:

1. Compare `(updatedAt, deviceId)` lexicographically-numerically.
2. If the incoming tuple is **greater**, the incoming record wins.
3. Otherwise the incoming record is **not** applied and its content is written
   to the `conflicts` table (server) or the local `conflicts` store (iPad).
4. When an incoming record wins over different content, the server stores
   `updatedAt = max(incoming.updatedAt, existing.updatedAt + 1)` and returns the
   new value in `accepted[]`. Clients adopt it, so both devices converge on the
   same numbers.

Because the tie-break uses `deviceId`, two devices that push at the same
millisecond still agree on the winner without a round trip.

### What the iPad does with a conflict

* The losing local copy is written to the `conflicts` table with its full JSON.
* The winning server copy becomes the canonical record on the iPad.
* **Sync → Conflicts** lists each one; *Keep this iPad* re-applies the local copy
  with a fresh timestamp and queues it for push; *Keep Windows* discards the
  entry. Nothing is deleted until one of those buttons is pressed.

### What the Windows server does with a conflict

* The losing copy is appended to `conflicts` (kind, object id, label, both
  payloads, timestamp).
* The winner stays in `objects`; the loser is also included in every backup as
  `conflicts.json`.

## Attachments

Asset bytes never travel inside JSON. The order is:

1. The client stores the blob in IndexedDB and queues the asset metadata record.
2. Push accepts the metadata.
3. The client `PUT`s each queued blob to `/api/sync/assets/{id}` (one file per
   record, skipped when the server already has the bytes).
4. On pull, an asset record without a local blob triggers a `GET`.

PDFs keep their original bytes: annotations are separate stroke records, which
is what allows re-export onto the untouched source page.

## Deletion

Deletes set `deletedAt` and bump `updatedAt`; the record is pushed exactly like
an edit. Both sides filter tombstones out of the UI, keep them in storage and
include them in backups, so a restore never resurrects deleted work and a
device that was offline still learns about deletions.

## Failure handling

* Every request has a 20 s timeout (8 s for the health probe).
* Network failures leave the outbox untouched and set the status to
  `error` with the message; the next run retries the same records.
* The queue is idempotent: re-pushing an identical record is a no-op.
* Sync never runs concurrently; a second manual request while one is in flight
  returns immediately.
