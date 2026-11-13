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
import { SyncClient, SyncError, normalizeServerUrl, pairWithCode } from './client';
import { detectLocalServer, detectPairingCode, planAdoption, type DetectedServer } from './discovery';
import { MAX_BATCH } from './protocol';
import { syncStatus } from './store';
import { now } from '../lib/id';
import { SYNC_INTERVAL_MS, retryDelay } from './backoff';

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

export interface AdoptionResult {
  state: 'paired' | 'connected';
  detected: DetectedServer;
}

let adopting: Promise<AdoptionResult | null> | null = null;
/** The page origin cannot change without a reload, so one answer serves all screens. */
let adopted: AdoptionResult | null | undefined;

/**
 * A page served by the laptop's own backend already belongs to a machine, so it
 * adopts that origin instead of asking for an address. When the laptop is the
 * one asking, it can also read its own pairing page and pair with no typing.
 * Pages served from GitHub cannot discover anything: there it returns null.
 */
export function adoptServedServer(): Promise<AdoptionResult | null> {
  if (adopted !== undefined) return Promise.resolve(adopted);
  adopting ??= runAdoption()
    .then((result) => {
      adopted = result;
      return result;
    })
    .finally(() => {
      adopting = null;
    });
  return adopting;
}

async function runAdoption(): Promise<AdoptionResult | null> {
  const config = await loadSyncConfig();
  const detected = await detectLocalServer();
  if (!detected) return null;
  const code = config.token.trim() ? null : await detectPairingCode();
  const plan = planAdoption(config, detected, code);
  if (plan.kind === 'none') return { state: 'connected', detected };
  if (plan.kind === 'repoint') {
    await saveSyncConfig({ serverUrl: plan.serverUrl });
    return { state: 'connected', detected };
  }
  try {
    const deviceId = await getDeviceId();
    const result = await pairWithCode(plan.serverUrl, plan.code, `Laptop ${deviceId.slice(0, 4)}`);
    // Stay on the address the page was served from, not the LAN one the server
    // reports: same-origin requests need no CORS entry and survive an IP change.
    await saveSyncConfig({ serverUrl: plan.serverUrl, token: result.token });
    return { state: 'paired', detected };
  } catch {
    // Keep the address even if pairing is refused: the form is then filled in.
    await saveSyncConfig({ serverUrl: plan.serverUrl });
    return { state: 'connected', detected };
  }
}

let inflight: Promise<SyncOutcome> | null = null;

export function syncNow(): Promise<SyncOutcome> {
  // A tap and a timer tick can land together: join the run instead of failing.
  inflight ??= runSync().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function runSync(): Promise<SyncOutcome> {
  const config = await loadSyncConfig();
  if (!config.serverUrl || !config.token) {
    await syncStatus.update({ phase: 'unconfigured', message: 'No pairing token configured' });
    return { ok: false, pushed: 0, pulled: 0, conflicts: 0, assets: 0, message: 'Not configured' };
  }
  if (!navigator.onLine) {
    await syncStatus.update({ phase: 'offline', message: 'Offline — changes are queued' });
    return { ok: false, pushed: 0, pulled: 0, conflicts: 0, assets: 0, message: 'Offline' };
  }

  const deviceId = await getDeviceId();
  const client = new SyncClient(config.serverUrl, config.token, deviceId);
  await syncStatus.update({ phase: 'syncing', message: 'Synchronising…' });

  let pushed = 0;
  let pulled = 0;
  let conflictCount = 0;
  let assets = 0;

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
      // Attachment bytes go first: if an upload fails, the queue entry survives
      // and the next run retries, instead of leaving a record without its file.
      const batchAssets = new Set(batch.filter((entry) => entry.kind === 'asset').map((entry) => entry.id));
      if (batchAssets.size > 0) assets += await uploadAssets(client, batchAssets);
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
        await recordConflict({
          kind: conflict.kind,
          objectId: conflict.id,
          label: describeRecord(conflict.kind, conflict.client.data),
          local: withoutBlob(conflict.client.data),
          server: withoutBlob(conflict.server.data),
        });
        await applyIncoming(conflict.server);
        await clearOutboxFor(conflict.kind, conflict.id);
        conflictCount += 1;
      }
      await db.outbox.bulkDelete(batch.map((b) => b.seq!).filter((n) => n !== undefined));
      pushed += records.size;
    }

    // 2. Pull remote changes since the stored cursor.
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

    // 3. Fetch asset bytes referenced by records that arrived without them.
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
    await syncStatus.update({ phase: 'error', message });
    await refreshCounters();
    return { ok: false, pushed, pulled, conflicts: conflictCount, assets, message };
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
    case 'equation':
      return db.equations;
    case 'graph':
      return db.graphs;
    case 'table':
      return db.tableObjects;
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
  if (kind === 'equation') return 'Equation';
  if (kind === 'graph') return entity.title || 'Graph';
  if (kind === 'table') return 'Table';
  return 'Attachment';
}

interface PendingConflict {
  kind: SyncKind;
  objectId: string;
  label: string;
  local: unknown;
  server: unknown;
}

/**
 * One row per object and decision. A push that is retried after a lost response
 * would otherwise pile up identical conflicts the reader has to dismiss twice.
 */
async function recordConflict(entry: PendingConflict): Promise<void> {
  const existing = await db.conflicts
    .where('objectId')
    .equals(entry.objectId)
    .filter((row) => row.kind === entry.kind)
    .first();
  if (existing?.seq !== undefined) {
    await db.conflicts.update(existing.seq, {
      label: entry.label,
      local: entry.local,
      server: entry.server,
    });
    return;
  }
  await db.conflicts.add({ ...entry, createdAt: now() });
}

/** A pulled asset carries metadata only; the bytes stay wherever they already are. */
async function applyIncoming(record: SyncRecord): Promise<void> {
  if (record.kind !== 'asset') {
    await applyRemoteRecord(record);
    return;
  }
  const existing = (await db.assets.get(record.id)) as StoredAsset | undefined;
  const next = { ...(record.data as StoredAsset) };
  if (existing?.blob) next.blob = existing.blob;
  await db.assets.put(next);
}

function withoutBlob(entity: unknown): unknown {
  if (entity && typeof entity === 'object' && 'blob' in (entity as Record<string, unknown>)) {
    const { blob: _blob, ...rest } = entity as Record<string, unknown>;
    return rest;
  }
  return entity;
}

async function applyPulledRecord(record: SyncRecord): Promise<{ applied: boolean; conflict: boolean }> {
  const local = await readEntity(record.kind, record.id);
  if (!local) {
    await applyIncoming(record);
    return { applied: true, conflict: false };
  }
  if (sameJson(withoutBlob(local), record.data)) {
    await clearOutboxFor(record.kind, record.id);
    return { applied: false, conflict: false };
  }
  const queued = await db.outbox.where('[kind+id]').equals([record.kind, record.id]).count();
  if (queued > 0) {
    await recordConflict({
      kind: record.kind,
      objectId: record.id,
      label: describeRecord(record.kind, record.data),
      local: withoutBlob(local),
      server: withoutBlob(record.data),
    });
    await applyIncoming(record);
    await clearOutboxFor(record.kind, record.id);
    return { applied: true, conflict: true };
  }
  if (record.updatedAt >= local.updatedAt) {
    await applyIncoming(record);
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

let listenersBound = false;
let failures = 0;
let timer: number | null = null;

/** One pending attempt at a time; a new schedule replaces the old one. */
function schedule(delay: number): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    void tick();
  }, delay);
}

async function tick(): Promise<void> {
  const config = await loadSyncConfig();
  if (!config.autoSync || !config.serverUrl || !config.token) {
    schedule(SYNC_INTERVAL_MS);
    return;
  }
  // While the iPad is offline there is nothing to try: keep the normal rhythm
  // so a missed `online` event still recovers within a minute.
  if (!navigator.onLine) {
    schedule(SYNC_INTERVAL_MS);
    return;
  }
  const pending = await pendingCount();
  if (document.visibilityState === 'hidden' && pending === 0) {
    schedule(SYNC_INTERVAL_MS);
    return;
  }
  const outcome = await syncNow();
  failures = outcome.ok ? 0 : failures + 1;
  schedule(retryDelay(failures));
}

export function startAutoSync(): void {
  if (listenersBound) return;
  listenersBound = true;
  schedule(4000);
  // Regaining a connection or returning to the app deserves an early attempt,
  // not a wait for the current backoff to run out.
  window.addEventListener('online', () => {
    failures = 0;
    schedule(1200);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule(900);
  });
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
