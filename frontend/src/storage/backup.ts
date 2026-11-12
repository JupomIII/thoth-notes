import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { db } from './db';
import type { SyncKind } from './types';
import { sha256Hex } from '../lib/hash';
import { now } from '../lib/id';
import { getDeviceId, markOutbox, readEntity, applyRemoteRecord } from './repo';

const FORMAT = 'thoth-backup';
const VERSION = 1;

const FILES: { path: string; kind: SyncKind }[] = [
  { path: 'folders.json', kind: 'folder' },
  { path: 'notebooks.json', kind: 'notebook' },
  { path: 'pages.json', kind: 'page' },
  { path: 'strokes.json', kind: 'stroke' },
  { path: 'texts.json', kind: 'text' },
  { path: 'images.json', kind: 'image' },
  { path: 'assets.json', kind: 'asset' },
];

export interface BackupManifest {
  format: string;
  version: number;
  appVersion: string;
  createdAt: number;
  deviceId: string;
  counts: Record<string, number>;
  checksums: Record<string, string>;
}

export interface LocalBackupResult {
  blob: Blob;
  counts: Record<string, number>;
  bytes: number;
}

function extensionFor(mime: string, name: string): string {
  const fromName = name.includes('.') ? name.split('.').pop()! : '';
  if (fromName) return fromName.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  return 'bin';
}

/** Builds a complete ZIP backup of the local database. */
export async function exportLocalBackup(): Promise<LocalBackupResult> {
  const files: Record<string, Uint8Array> = {};
  const checksums: Record<string, string> = {};
  const counts: Record<string, number> = {};

  for (const { path, kind } of FILES) {
    const rows = await tableRows(kind);
    counts[kind] = rows.length;
    const bytes = strToU8(JSON.stringify(rows));
    files[path] = bytes;
    checksums[path] = await sha256Hex(bytes);
  }

  const assets = await db.assets.toArray();
  const assetManifest: { id: string; file: string }[] = [];
  for (const asset of assets) {
    // Metadata-only records exist until the bytes arrive from the server.
    if (!asset.blob || asset.blob.size === 0) continue;
    const ext = extensionFor(asset.mime, asset.name);
    const file = `assets/${asset.id}.${ext}`;
    const buffer = new Uint8Array(await asset.blob.arrayBuffer());
    files[file] = buffer;
    checksums[file] = await sha256Hex(buffer);
    assetManifest.push({ id: asset.id, file });
  }
  const assetIndex = strToU8(JSON.stringify(assetManifest));
  files['asset-files.json'] = assetIndex;
  checksums['asset-files.json'] = await sha256Hex(assetIndex);

  const manifest: BackupManifest = {
    format: FORMAT,
    version: VERSION,
    appVersion: '1.0.0',
    createdAt: now(),
    deviceId: await getDeviceId(),
    counts,
    checksums,
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));

  const zipped = zipSync(files, { level: 6 });
  return {
    blob: new Blob([zipped.slice().buffer], { type: 'application/zip' }),
    counts,
    bytes: zipped.byteLength,
  };
}

async function tableRows(kind: SyncKind): Promise<unknown[]> {
  switch (kind) {
    case 'folder':
      return db.folders.toArray();
    case 'notebook':
      return db.notebooks.toArray();
    case 'page':
      return db.pages.toArray();
    case 'stroke':
      return db.strokes.toArray();
    case 'text':
      return db.texts.toArray();
    case 'image':
      return db.images.toArray();
    case 'asset':
      return (await db.assets.toArray()).map(({ blob: _blob, ...rest }) => rest);
  }
}

/**
 * Restores from a backup ZIP built by this app or by the Windows backend.
 * Existing, newer records are kept, so restoring never creates duplicates.
 */
export async function importLocalBackup(file: Blob): Promise<{
  ok: boolean;
  inserted: number;
  updated: number;
  skipped: number;
  assets: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let assetCount = 0;

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return { ok: false, inserted, updated, skipped, assets: 0, errors: ['File is not a valid ZIP archive'] };
  }

  const manifestBytes = entries['manifest.json'];
  if (!manifestBytes) {
    return { ok: false, inserted, updated, skipped, assets: 0, errors: ['manifest.json is missing'] };
  }
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(strFromU8(manifestBytes)) as BackupManifest;
  } catch {
    return { ok: false, inserted, updated, skipped, assets: 0, errors: ['manifest.json is not valid JSON'] };
  }
  if (manifest.format !== FORMAT || typeof manifest.version !== 'number') {
    return { ok: false, inserted, updated, skipped, assets: 0, errors: ['Unsupported backup format'] };
  }

  for (const [path, expected] of Object.entries(manifest.checksums ?? {})) {
    const bytes = entries[path];
    if (!bytes) {
      errors.push(`Missing entry: ${path}`);
      continue;
    }
    const actual = await sha256Hex(bytes);
    if (actual !== expected) errors.push(`Checksum mismatch: ${path}`);
  }
  if (errors.length > 0) {
    return { ok: false, inserted, updated, skipped, assets: 0, errors };
  }

  for (const { path, kind } of FILES) {
    const bytes = entries[path];
    if (!bytes) continue;
    let rows: unknown[];
    try {
      rows = JSON.parse(strFromU8(bytes)) as unknown[];
    } catch {
      errors.push(`${path} is not valid JSON`);
      continue;
    }
    for (const row of rows) {
      const entity = row as { id?: string; updatedAt?: number; deletedAt?: number | null };
      if (!entity.id || typeof entity.updatedAt !== 'number') {
        skipped += 1;
        continue;
      }
      const existing = await readEntity(kind, entity.id);
      if (!existing) {
        await applyRemoteRecord({ kind, id: entity.id, data: row, createdAt: 0, updatedAt: entity.updatedAt, version: 1, deviceId: '', deletedAt: entity.deletedAt ?? null });
        await markOutbox(kind, entity.id);
        inserted += 1;
      } else if (existing.updatedAt < entity.updatedAt) {
        await applyRemoteRecord({ kind, id: entity.id, data: row, createdAt: 0, updatedAt: entity.updatedAt, version: 1, deviceId: '', deletedAt: entity.deletedAt ?? null });
        await markOutbox(kind, entity.id);
        updated += 1;
      } else {
        skipped += 1;
      }
    }
  }

  const assetIndexBytes = entries['asset-files.json'];
  if (assetIndexBytes) {
    const index = JSON.parse(strFromU8(assetIndexBytes)) as { id: string; file: string }[];
    for (const item of index) {
      const bytes = entries[item.file];
      const meta = await db.assets.get(item.id);
      if (!bytes || !meta) {
        skipped += 1;
        continue;
      }
      const existing = await db.assets.get(item.id);
      if (existing && existing.blob.size > 0) {
        skipped += 1;
        continue;
      }
      await db.assets.put({ ...meta, blob: new Blob([bytes.slice().buffer], { type: meta.mime }) });
      await markOutbox('asset', item.id);
      assetCount += 1;
    }
  }

  return { ok: errors.length === 0, inserted, updated, skipped, assets: assetCount, errors };
}
