import Dexie, { type Table } from 'dexie';
import type {
  Folder,
  ImagePlacement,
  Notebook,
  Page,
  StoredAsset,
  Stroke,
  TextBlock,
} from './types';

export interface OutboxEntry {
  seq?: number;
  kind: string;
  id: string;
}

export interface SyncStateRow {
  key: string;
  value: unknown;
}

export interface ConflictRow {
  seq?: number;
  kind: string;
  objectId: string;
  label: string;
  local: unknown;
  server: unknown;
  createdAt: number;
}

export interface DraftRow {
  pageId: string;
  stroke: Stroke;
  savedAt: number;
}

export interface ThumbnailRow {
  pageId: string;
  dataUrl: string;
  updatedAt: number;
}

export interface RevisionRow {
  id?: number;
  pageId: string;
  snapshot: unknown;
  createdAt: number;
}

/**
 * The single IndexedDB database. Application code and user notes are kept
 * strictly apart: the service worker only ever caches build output.
 */
export class ThothDatabase extends Dexie {
  folders!: Table<Folder, string>;
  notebooks!: Table<Notebook, string>;
  pages!: Table<Page, string>;
  strokes!: Table<Stroke, string>;
  texts!: Table<TextBlock, string>;
  images!: Table<ImagePlacement, string>;
  assets!: Table<StoredAsset, string>;
  outbox!: Table<OutboxEntry, number>;
  syncState!: Table<SyncStateRow, string>;
  conflicts!: Table<ConflictRow, number>;
  drafts!: Table<DraftRow, string>;
  revisions!: Table<RevisionRow, number>;
  thumbnails!: Table<ThumbnailRow, string>;

  constructor() {
    super('thoth-notes');
    this.version(1).stores({
      folders: 'id, parentId, updatedAt, deletedAt',
      notebooks: 'id, folderId, updatedAt, archived, favorite, title, deletedAt',
      pages: 'id, notebookId, [notebookId+index], updatedAt, deletedAt',
      strokes: 'id, pageId, updatedAt, deletedAt',
      texts: 'id, pageId, updatedAt, deletedAt',
      images: 'id, pageId, updatedAt, deletedAt',
      assets: 'id, updatedAt, deletedAt',
      outbox: '++seq, kind, id, [kind+id]',
      syncState: 'key',
      conflicts: '++seq, kind, objectId, createdAt',
      drafts: 'pageId, savedAt',
      revisions: '++id, pageId, createdAt',
    });
    // v2: notebook sort ordering index for the library grid.
    this.version(2).stores({
      notebooks: 'id, folderId, updatedAt, archived, favorite, title, sortIndex, deletedAt',
    });
    // v3: page thumbnails are device-local so they never bloat sync payloads.
    this.version(3).stores({
      thumbnails: 'pageId, updatedAt',
    });
  }
}

export const db = new ThothDatabase();
