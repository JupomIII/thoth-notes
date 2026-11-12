import { db } from '../storage/db';
import type { StoredAsset, SyncKind, SyncRecord } from '../storage/types';
import {
  applyRemoteRecord,
  clearOutboxFor,
  getDeviceId,
  getSyncState,
  markOutbox,
  pendingCount,
  readEntity,
  setSyncState,
} from '../storage/repo';
import { SyncClient, SyncError, normalizeServerUrl } from './client';
import { MAX_BATCH } from './protocol';
import { syncStatus } from './store';
import { now } from '../lib/id';

export interface SyncConfig {
  serverUrl: string;
  token: string;
  autoSync: boolean;
}

export interface SyncOutcome {
  ok: boolean;
  pushed: number;
  pulled: number;
  conflicts: number;
  assets: number;
  message: string;
}

const CONFIG_KEY = 'syncConfig';
const CURSOR_KEY = 'pullCursor';

export async function loadSyncConfig(): Promise<SyncConfig> {
  const config = await getSyncState<SyncConfig>(CONFIG_KEY, {
    serverUrl: '',
    token: '',
    autoSync: true,
  });
  return {
    serverUrl: config.serverUrl ?? '',
    token: config.token ?? '',
    autoSync: config.autoSync !== false,
  };
}

export async function saveSyncConfig(patch: Partial<SyncConfig>): Promise<SyncConfig> {
  const current = await loadSyncConfig();
  const next: SyncConfig = {
    serverUrl: normalizeServerUrl(patch.serverUrl ?? current.serverUrl),
    token: (patch.token ?? current.token).trim(),
    autoSync: patch.autoSync ?? current.autoSync,
  };
  await setSyncState(CONFIG_KEY, next);
  await syncStatus.update({ phase: next.serverUrl && next.token ? 'idle' : 'unconfigured' });
  return next;
}

export async function refreshCounters(): Promise<void> {
  const [pending, conflicts] = await Promise.all([pendingCount(), db.conflicts.count()]);
  const config = await loadSyncConfig();
  const lastSyncAt = await getSyncState<number | null>('lastSyncAt', null);
  syncStatus.update({
    pending,
    conflicts,
    lastSyncAt,
    phase:
      syncStatus.getSnapshot().phase === 'syncing'
        ? 'syncing'
        : !config.serverUrl || !config.token
          ? 'unconfigured'
          : syncStatus.getSnapshot().phase === 'error'
            ? 'error'
            : syncStatus.getSnapshot().online
              ? 'idle'
              : 'offline',
  });
}

export async function testConnection(
  serverUrl: string,
  token: string,
): Promise<{ ok: boolean; message: string }> {
  const deviceId = await getDeviceId();
  const client = new SyncClient(serverUrl, token, deviceId);
  try {
    const health = await client.health();
    return { ok: true, message: `${health.deviceName || 'Windows server'} · protocol v${health.version}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection failed';
    return { ok: false, message };
  }
}

let running = false;

export async function syncNow(options: { silent?: boolean } = {}): Promise<SyncOutcome> {
  if (running) {
    return { ok: false, pushed: 0, pulled: 0, conflicts: 0, assets: 0, message: 'Sync already running' };
  }
  const config = await loadSyncConfig();
  if (!config.serverUrl || !config.token) {
    await syncStatus.update({ phase: 'unconfigured', message: 'No pairing token configured' });
    return { ok: false, pushed: 0, pulled: 0, conflicts: 0, assets: 0, message: 'Not configured' };
  }
  if (!navigator.onLine) {
    await syncStatus.update({ phase: 'offline', message: 'Offline — changes are queued' });
    return { ok: false, pushed: 0, pulled: 0, conflicts: 0, assets: 0, message: 'Offline' };
  }

  running = true;
  const deviceId = await getDeviceId();
  const client = new SyncClient(config.serverUrl, config.token, deviceId);
  await syncStatus.update({ phase: 'syncing', message: 'Synchronising…' });

  let pushed = 0;
  let pulled = 0;
  let conflictCount = 0;
  let assets = 0;
  const assetsToUpload = new Set<string>();

  try {
    // 1. Push local changes in bounded batches.
    for (;;) {
      const batch = await db.outbox.limit(MAX_BATCH).toArray();
      if (batch.length === 0) break;
      const records = new Map<string, SyncRecord>();
      for (const entry of batch) {
        const key = `${entry.kind}:${entry.id}`;
        if (records.has(key)) continue;
        const entity = await readEntity(entry.kind as SyncKind, entry.id);
        if (!entity) continue;
        let data: unknown = entity;
        if (entry.kind === 'asset') {
          const { blob: _blob, ...meta } = entity as unknown as StoredAsset;
          data = meta;
        }
        if (entry.kind === 'asset') assetsToUpload.add(entry.id);
        records.set(key, {
          kind: entry.kind as SyncKind,
          id: entity.id,
          data,
          createdAt: entity.createdAt,
          updatedAt: entity.updatedAt,
          version: entity.version,
          deviceId: entity.deviceId || deviceId,
          deletedAt: entity.deletedAt,
        });
      }
      if (records.size === 0) {
        await db.outbox.bulkDelete(batch.map((b) => b.seq!).filter((n) => n !== undefined));
        continue;
      }
      const response = await client.push([...records.values()]);
      for (const accepted of response.accepted) {
        const local = await readEntity(accepted.kind, accepted.id);
        if (!local) continue;
        if (local.version !== accepted.version || local.updatedAt !== accepted.updatedAt) {
          const table = tableForKind(accepted.kind) as unknown as {
            put: (value: unknown) => Promise<unknown>;
          };
          await table.put({ ...local, version: accepted.version, updatedAt: accepted.updatedAt });
        }
      }
      for (const conflict of response.conflicts) {
        await db.conflicts.add({
          kind: conflict.kind,
          objectId: conflict.id,
          label: describeRecord(conflict.kind, conflict.client.data),
          local: conflict.client.data,
          server: conflict.server.data,
          createdAt: now(),
        });
        await applyRemoteRecord(conflict.server);
        await clearOutboxFor(conflict.kind, conflict.id);
        conflictCount += 1;
      }
      await db.outbox.bulkDelete(batch.map((b) => b.seq!).filter((n) => n !== undefined));
      pushed += records.size;
      if (records.size === 0) break;
    }

    // 2. Upload attachment bytes for assets queued in this run.
    assets = await uploadAssets(client, assetsToUpload);

    // 3. Pull remote changes since the stored cursor.
    await setSyncState('lastSyncAt', now());
    for (;;) {
      const cursor = await getSyncState<number>(CURSOR_KEY, 0);
      const changes = await client.changes(cursor);
      for (const record of changes.records) {
        const outcome = await applyPulledRecord(record);
        pulled += outcome.applied ? 1 : 0;
        conflictCount += outcome.conflict ? 1 : 0;
      }
      await setSyncState(CURSOR_KEY, changes.cursor);
      if (!changes.hasMore) break;
    }

    // 4. Fetch asset bytes referenced by records that arrived without them.
    const downloaded = await downloadMissingAssets(client);
    assets += downloaded;

    await setSyncState('lastSyncAt', now());
    await syncStatus.update({
      phase: 'success',
      message: `Synced ${pushed} up · ${pulled} down${conflictCount ? ` · ${conflictCount} conflicts` : ''}`,
      lastSyncAt: now(),
    });
    syncStatus.bumpDataVersion();
    await refreshCounters();
    return {
      ok: true,
      pushed,
      pulled,
      conflicts: conflictCount,
      assets,
      message: syncStatus.getSnapshot().message,
    };
  } catch (error) {
    const message =
      error instanceof SyncError
        ? error.kind === 'auth'
          ? 'Pairing token rejected — check the token on the Windows server'
          : error.message
        : error instanceof Error
          ? error.message
          : 'Unknown sync error';
    await syncStatus.update({ phase: 'error', message: options.silent ? `Sync failed: ${message}` : message });
    await refreshCounters();
    return { ok: false, pushed, pulled, conflicts: conflictCount, assets, message };
  } finally {
    running = false;
  }
}

async function uploadAssets(client: SyncClient, assetIds: Set<string>): Promise<number> {
  let count = 0;
  for (const id of assetIds) {
    const asset = (await db.assets.get(id)) as StoredAsset | undefined;
    if (!asset?.blob) continue;
    await client.uploadAsset(id, asset.blob, asset.mime);
    count += 1;
  }
  return count;
}

async function downloadMissingAssets(client: SyncClient): Promise<number> {
  const assets = await db.assets.toArray();
  let count = 0;
  for (const asset of assets) {
    if (asset.deletedAt !== null) continue;
    if (asset.blob && asset.blob.size > 0) continue;
    try {
      const blob = await client.downloadAsset(asset.id);
      await db.assets.put({ ...asset, blob });
      count += 1;
    } catch {
      // Leave the record; the next sync retries the download.
    }
  }
  return count;
}

function tableForKind(kind: SyncKind) {
  switch (kind) {
    case 'folder':
      return db.folders;
    case 'notebook':
      return db.notebooks;
    case 'page':
      return db.pages;
    case 'stroke':
      return db.strokes;
    case 'text':
      return db.texts;
    case 'image':
      return db.images;
    case 'asset':
      return db.assets;
  }
}

function describeRecord(kind: SyncKind, data: unknown): string {
  const entity = data as { title?: string; name?: string; text?: string; tool?: string };
  if (kind === 'notebook') return entity.title || 'Notebook';
  if (kind === 'folder') return entity.name || 'Folder';
  if (kind === 'page') return `Page ${entity.title || ''}`.trim();
  if (kind === 'stroke') return `Stroke (${entity.tool ?? 'ink'})`;
  if (kind === 'text') return 'Text block';
  if (kind === 'image') return 'Image placement';
  return 'Attachment';
}

async function applyPulledRecord(record: SyncRecord): Promise<{ applied: boolean; conflict: boolean }> {
  const local = await readEntity(record.kind, record.id);
  if (!local) {
    await applyRemoteRecord(record);
    return { applied: true, conflict: false };
  }
  if (sameJson(local, record.data)) {
    await clearOutboxFor(record.kind, record.id);
    return { applied: false, conflict: false };
  }
  const queued = await db.outbox.where('[kind+id]').equals([record.kind, record.id]).count();
  if (queued > 0) {
    await db.conflicts.add({
      kind: record.kind,
      objectId: record.id,
      label: describeRecord(record.kind, record.data),
      local,
      server: record.data,
      createdAt: now(),
    });
    await applyRemoteRecord(record);
    await clearOutboxFor(record.kind, record.id);
    return { applied: true, conflict: true };
  }
  if (record.updatedAt >= local.updatedAt) {
    await applyRemoteRecord(record);
    return { applied: true, conflict: false };
  }
  await markOutbox(record.kind, record.id);
  return { applied: false, conflict: false };
}

/** Order-independent comparison: JSON key order differs between devices. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

function sameJson(local: unknown, incoming: unknown): boolean {
  return stableStringify(local) === stableStringify(incoming);
}

let autoTimer: number | null = null;
let listenersBound = false;

export function startAutoSync(): void {
  if (listenersBound) return;
  listenersBound = true;
  const tick = () => {
    void (async () => {
      const config = await loadSyncConfig();
      if (!config.autoSync || !config.serverUrl || !config.token) return;
      const pending = await pendingCount();
      if (document.visibilityState === 'hidden' && pending === 0) return;
      await syncNow({ silent: true });
    })();
  };
  autoTimer = window.setInterval(tick, 45000);
  window.addEventListener('online', () => {
    void syncNow({ silent: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick();
  });
  window.setTimeout(tick, 4000);
}

export function stopAutoSync(): void {
  if (autoTimer !== null) window.clearInterval(autoTimer);
  autoTimer = null;
}

export async function resolveConflict(seq: number, strategy: 'keep-local' | 'keep-server'): Promise<void> {
  const conflict = await db.conflicts.get(seq);
  if (!conflict) return;
  if (strategy === 'keep-local') {
    const local = conflict.local as { updatedAt?: number };
    const record: SyncRecord = {
      kind: conflict.kind as SyncKind,
      id: conflict.objectId,
      data: local,
      createdAt: 0,
      updatedAt: Math.max(now(), (local.updatedAt ?? 0) + 1),
      version: 1,
      deviceId: await getDeviceId(),
      deletedAt: null,
    };
    const localData = { ...(conflict.local as Record<string, unknown>), updatedAt: record.updatedAt };
    await applyRemoteRecord({ ...record, data: localData });
    await markOutbox(conflict.kind as SyncKind, conflict.objectId);
  }
  await db.conflicts.delete(seq);
  await refreshCounters();
}
