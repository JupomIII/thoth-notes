import type { Table } from 'dexie';
import { db } from './db';
import type {
  AppSettings,
  Envelope,
  Folder,
  ImagePlacement,
  Notebook,
  Page,
  StoredAsset,
  Stroke,
  SyncKind,
  SyncRecord,
  TextBlock,
} from './types';
import { DEFAULT_TOOL_SETTINGS, PAGE_SIZES } from './types';
import { newId, now } from '../lib/id';

type AnyEntity = Envelope & Record<string, unknown>;
type EntityTable = Table<AnyEntity, string>;

function tableFor(kind: SyncKind): EntityTable {
  switch (kind) {
    case 'folder':
      return db.folders as unknown as EntityTable;
    case 'notebook':
      return db.notebooks as unknown as EntityTable;
    case 'page':
      return db.pages as unknown as EntityTable;
    case 'stroke':
      return db.strokes as unknown as EntityTable;
    case 'text':
      return db.texts as unknown as EntityTable;
    case 'image':
      return db.images as unknown as EntityTable;
    case 'asset':
      return db.assets as unknown as EntityTable;
  }
}

const DEVICE_KEY = 'deviceId';

export async function getDeviceId(): Promise<string> {
  const row = await db.syncState.get(DEVICE_KEY);
  if (row && typeof row.value === 'string') return row.value;
  const id = newId();
  await db.syncState.put({ key: DEVICE_KEY, value: id });
  return id;
}

const DEFAULT_SETTINGS: AppSettings = {
  toolbarPosition: null,
  toolbarCollapsed: false,
  oneFingerPan: true,
  palmRejection: true,
  showPageBoundary: true,
  serverUrl: '',
  autoSync: true,
  eraserMode: 'stroke',
};

export async function getSettings(): Promise<AppSettings> {
  const row = await db.syncState.get('settings');
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<AppSettings>) ?? {}) };
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await db.syncState.put({ key: 'settings', value: next });
  return next;
}

export function defaultToolSettings() {
  return structuredClone(DEFAULT_TOOL_SETTINGS);
}

/** Marks an object as locally dirty so the sync engine pushes it. */
export async function markOutbox(kind: SyncKind, id: string): Promise<void> {
  const existing = await db.outbox.where('[kind+id]').equals([kind, id]).count();
  if (existing === 0) await db.outbox.add({ kind, id });
}

export async function pendingCount(): Promise<number> {
  return db.outbox.count();
}

/** Applies local metadata (updatedAt/version) then persists and queues. */
export async function touch<T extends Envelope>(entity: T): Promise<T> {
  const next = { ...entity, updatedAt: now(), version: entity.version + 1 };
  await tableFor(kindOfEntity(entity)).put(next as unknown as AnyEntity);
  await markOutbox(kindOfEntity(next), next.id);
  return next;
}

function kindOfEntity(entity: Envelope): SyncKind {
  if ('notebookId' in entity) return 'page';
  if ('pageId' in entity) {
    if ('points' in entity) return 'stroke';
    if ('text' in entity) return 'text';
    return 'image';
  }
  if ('parentId' in entity) return 'folder';
  if ('title' in entity) {
    if ('coverColor' in entity) return 'notebook';
  }
  if ('mime' in entity) return 'asset';
  return 'notebook';
}

export async function baseEnvelope(): Promise<Envelope> {
  const t = now();
  return {
    id: newId(),
    createdAt: t,
    updatedAt: t,
    version: 1,
    deviceId: await getDeviceId(),
    deletedAt: null,
  };
}

/* ------------------------------------------------------------------ */
/* Notebooks and folders                                               */
/* ------------------------------------------------------------------ */

export async function createNotebook(input: {
  title?: string;
  folderId?: string | null;
  coverColor?: string;
  template?: Page['template'];
  size?: Page['size'];
}): Promise<Notebook> {
  const env = await baseEnvelope();
  const notebook: Notebook = {
    ...env,
    title: input.title?.trim() || 'Untitled notebook',
    folderId: input.folderId ?? null,
    coverColor: input.coverColor ?? '#4a6156',
    favorite: false,
    archived: false,
    sortIndex: now(),
    lastOpenedAt: null,
  };
  await db.notebooks.put(notebook);
  await markOutbox('notebook', notebook.id);
  await createPage(notebook.id, {
    template: input.template ?? 'ruled',
    size: input.size ?? 'a4',
    index: 0,
  });
  return notebook;
}

export async function createFolder(name: string, parentId: string | null = null): Promise<Folder> {
  const env = await baseEnvelope();
  const folder: Folder = {
    ...env,
    name: name.trim() || 'New folder',
    parentId,
    color: '#7c766b',
  };
  await db.folders.put(folder);
  await markOutbox('folder', folder.id);
  return folder;
}

export async function updateNotebook(id: string, patch: Partial<Notebook>): Promise<void> {
  const current = await db.notebooks.get(id);
  if (!current) return;
  await touch({ ...current, ...patch, id });
}

export async function updateFolder(id: string, patch: Partial<Folder>): Promise<void> {
  const current = await db.folders.get(id);
  if (!current) return;
  await touch({ ...current, ...patch, id });
}

export async function createPage(
  notebookId: string,
  input: Partial<Pick<Page, 'template' | 'size' | 'index' | 'pdfAssetId' | 'pdfPageIndex' | 'title'>>,
): Promise<Page> {
  const env = await baseEnvelope();
  const size = input.size ?? 'a4';
  const dims = PAGE_SIZES[size];
  let index = input.index;
  if (index === undefined) {
    const existing = await db.pages.where('notebookId').equals(notebookId).toArray();
    index = existing.filter((p) => p.deletedAt === null).length;
  }
  const page: Page = {
    ...env,
    notebookId,
    index,
    title: input.title ?? '',
    template: input.template ?? 'ruled',
    size,
    width: dims.width,
    height: dims.height,
    pdfAssetId: input.pdfAssetId ?? null,
    pdfPageIndex: input.pdfPageIndex ?? 0,
    backgroundTint: null,
  };
  await db.pages.put(page);
  await markOutbox('page', page.id);
  await updateNotebook(notebookId, {});
  return page;
}

/** Duplicates a page including strokes, text and images. */
export async function duplicatePage(pageId: string): Promise<Page | null> {
  const page = await db.pages.get(pageId);
  if (!page) return null;
  const siblings = await activePages(page.notebookId);
  const env = await baseEnvelope();
  const copy: Page = {
    ...page,
    ...env,
    index: siblings.length,
    title: page.title ? `${page.title} (copy)` : '',
  };
  await db.pages.put(copy);
  await markOutbox('page', copy.id);
  const strokes = await db.strokes.where('pageId').equals(pageId).toArray();
  for (const stroke of strokes) {
    if (stroke.deletedAt !== null) continue;
    const sEnv = await baseEnvelope();
    const clone: Stroke = {
      ...stroke,
      ...sEnv,
      pageId: copy.id,
      points: stroke.points.map((p) => ({ ...p })),
    };
    await db.strokes.put(clone);
    await markOutbox('stroke', clone.id);
  }
  const texts = await db.texts.where('pageId').equals(pageId).toArray();
  for (const text of texts) {
    if (text.deletedAt !== null) continue;
    const tEnv = await baseEnvelope();
    const clone: TextBlock = { ...text, ...tEnv, pageId: copy.id };
    await db.texts.put(clone);
    await markOutbox('text', clone.id);
  }
  const images = await db.images.where('pageId').equals(pageId).toArray();
  for (const image of images) {
    if (image.deletedAt !== null) continue;
    const iEnv = await baseEnvelope();
    const clone: ImagePlacement = { ...image, ...iEnv, pageId: copy.id };
    await db.images.put(clone);
    await markOutbox('image', clone.id);
  }
  const thumb = await db.thumbnails.get(pageId);
  if (thumb) await db.thumbnails.put({ ...thumb, pageId: copy.id, updatedAt: now() });
  return copy;
}

export async function duplicateNotebook(notebookId: string): Promise<Notebook | null> {
  const source = await db.notebooks.get(notebookId);
  if (!source) return null;
  const copy = await createNotebook({
    title: `${source.title} (copy)`,
    folderId: source.folderId,
    coverColor: source.coverColor,
  });
  const pages = await activePages(notebookId);
  await db.pages.where('notebookId').equals(copy.id).delete();
  for (const page of pages) {
    const env = await baseEnvelope();
    const newPage: Page = { ...page, ...env, notebookId: copy.id, index: page.index };
    await db.pages.put(newPage);
    await markOutbox('page', newPage.id);
    const strokes = await db.strokes.where('pageId').equals(page.id).toArray();
    for (const stroke of strokes) {
      if (stroke.deletedAt !== null) continue;
      const sEnv = await baseEnvelope();
      const clone: Stroke = {
        ...stroke,
        ...sEnv,
        pageId: newPage.id,
        points: stroke.points.map((p) => ({ ...p })),
      };
      await db.strokes.put(clone);
      await markOutbox('stroke', clone.id);
    }
    const texts = await db.texts.where('pageId').equals(page.id).toArray();
    for (const text of texts) {
      if (text.deletedAt !== null) continue;
      const tEnv = await baseEnvelope();
      const clone: TextBlock = { ...text, ...tEnv, pageId: newPage.id };
      await db.texts.put(clone);
      await markOutbox('text', clone.id);
    }
    const images = await db.images.where('pageId').equals(page.id).toArray();
    for (const image of images) {
      if (image.deletedAt !== null) continue;
      const iEnv = await baseEnvelope();
      const clone: ImagePlacement = { ...image, ...iEnv, pageId: newPage.id };
      await db.images.put(clone);
      await markOutbox('image', clone.id);
    }
  }
  return copy;
}

export async function activePages(notebookId: string): Promise<Page[]> {
  const pages = await db.pages.where('notebookId').equals(notebookId).toArray();
  return pages
    .filter((p) => p.deletedAt === null)
    .sort((a, b) => a.index - b.index || a.createdAt - b.createdAt);
}

export async function activeNotebooks(): Promise<Notebook[]> {
  const all = await db.notebooks.toArray();
  return all.filter((n) => n.deletedAt === null);
}

export async function activeFolders(): Promise<Folder[]> {
  const all = await db.folders.toArray();
  return all.filter((f) => f.deletedAt === null);
}

/* ------------------------------------------------------------------ */
/* Tombstones and cascades                                             */
/* ------------------------------------------------------------------ */

export async function softDeleteEntity(
  kind: SyncKind,
  id: string,
  cascade: boolean,
): Promise<void> {
  const t = now();
  const table = tableFor(kind);
  const entity = await table.get(id);
  if (!entity) return;
  await table.put({ ...entity, deletedAt: t, updatedAt: t, version: entity.version + 1 });
  await markOutbox(kind, id);
  if (!cascade) return;

  if (kind === 'notebook') {
    const pages = await db.pages.where('notebookId').equals(id).toArray();
    for (const page of pages) {
      if (page.deletedAt !== null) continue;
      await softDeleteEntity('page', page.id, false);
    }
  }
  if (kind === 'page') {
    const strokes = await db.strokes.where('pageId').equals(id).toArray();
    for (const s of strokes) {
      if (s.deletedAt !== null) continue;
      await softDeleteEntity('stroke', s.id, false);
    }
    const texts = await db.texts.where('pageId').equals(id).toArray();
    for (const x of texts) {
      if (x.deletedAt !== null) continue;
      await softDeleteEntity('text', x.id, false);
    }
    const images = await db.images.where('pageId').equals(id).toArray();
    for (const x of images) {
      if (x.deletedAt !== null) continue;
      await softDeleteEntity('image', x.id, false);
    }
    await db.drafts.delete(id);
    await db.thumbnails.delete(id);
  }
  if (kind === 'folder') {
    const children = await db.folders.where('parentId').equals(id).toArray();
    for (const child of children) {
      if (child.deletedAt !== null) continue;
      await softDeleteEntity('folder', child.id, true);
    }
    const notebooks = await db.notebooks.where('folderId').equals(id).toArray();
    for (const nb of notebooks) {
      if (nb.deletedAt !== null) continue;
      await softDeleteEntity('notebook', nb.id, true);
    }
  }
}

export async function deleteNotebook(id: string): Promise<void> {
  await softDeleteEntity('notebook', id, true);
}

export async function deletePage(pageId: string): Promise<void> {
  await softDeleteEntity('page', pageId, true);
  const page = await db.pages.get(pageId);
  if (!page) return;
  const siblings = await activePages(page.notebookId);
  let index = 0;
  for (const sibling of siblings) {
    if (sibling.index !== index) {
      await touch({ ...sibling, index });
    }
    index += 1;
  }
}

/* ------------------------------------------------------------------ */
/* Page content                                                        */
/* ------------------------------------------------------------------ */

export async function loadPageContent(pageId: string): Promise<{
  strokes: Stroke[];
  texts: TextBlock[];
  images: ImagePlacement[];
}> {
  const [strokes, texts, images] = await Promise.all([
    db.strokes.where('pageId').equals(pageId).toArray(),
    db.texts.where('pageId').equals(pageId).toArray(),
    db.images.where('pageId').equals(pageId).toArray(),
  ]);
  return {
    strokes: strokes
      .filter((s) => s.deletedAt === null)
      .sort((a, b) => a.createdAt - b.createdAt),
    texts: texts.filter((t) => t.deletedAt === null),
    images: images.filter((i) => i.deletedAt === null),
  };
}

export async function getAssetBlob(assetId: string): Promise<Blob | null> {
  const asset = await db.assets.get(assetId);
  return asset ? asset.blob : null;
}

/* ------------------------------------------------------------------ */
/* Sync helpers                                                        */
/* ------------------------------------------------------------------ */

export function toSyncRecord(kind: SyncKind, entity: AnyEntity): SyncRecord {
  return {
    kind,
    id: entity.id,
    data: entity,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    version: entity.version,
    deviceId: entity.deviceId,
    deletedAt: entity.deletedAt,
  };
}

export async function readEntity(kind: SyncKind, id: string): Promise<AnyEntity | undefined> {
  return tableFor(kind).get(id);
}

export async function applyRemoteRecord(record: SyncRecord): Promise<void> {
  await tableFor(record.kind).put(record.data as AnyEntity);
}

export async function clearOutboxFor(kind: string, id: string): Promise<void> {
  const entries = await db.outbox.where('[kind+id]').equals([kind, id]).toArray();
  await db.outbox.bulkDelete(entries.map((e) => e.seq!).filter((n) => n !== undefined));
}

export async function getSyncState<T>(key: string, fallback: T): Promise<T> {
  const row = await db.syncState.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setSyncState(key: string, value: unknown): Promise<void> {
  await db.syncState.put({ key, value });
}

export async function listAssets(): Promise<StoredAsset[]> {
  const all = await db.assets.toArray();
  return all.filter((a) => a.deletedAt === null);
}
