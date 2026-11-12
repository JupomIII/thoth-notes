import { db } from './db';
import type { ImagePlacement, Stroke, TextBlock } from './types';
import { markOutbox } from './repo';
import { now } from '../lib/id';
import type { PagePersistence } from '../drawing/engine';

/**
 * Buffers writes from the drawing engine so a burst of strokes becomes a
 * handful of IndexedDB transactions, while never holding data more than a
 * few hundred milliseconds.
 */
interface Pending {
  addStrokes: Stroke[];
  updateStrokes: Stroke[];
  deleteStrokes: Set<string>;
  addTexts: TextBlock[];
  updateTexts: TextBlock[];
  deleteTexts: Set<string>;
  addImages: ImagePlacement[];
  updateImages: ImagePlacement[];
  deleteImages: Set<string>;
}

function emptyPending(): Pending {
  return {
    addStrokes: [],
    updateStrokes: [],
    deleteStrokes: new Set(),
    addTexts: [],
    updateTexts: [],
    deleteTexts: new Set(),
    addImages: [],
    updateImages: [],
    deleteImages: new Set(),
  };
}

export class PageWriteBuffer {
  private pending: Pending = emptyPending();
  private timer: number | null = null;
  private flushing: Promise<void> | null = null;

  constructor(private readonly onChange: () => void) {}

  flushSoon(): void {
    this.queue();
  }

  private queue(): void {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 120);
  }

  async flush(): Promise<void> {
    if (this.flushing) {
      await this.flushing;
      return;
    }
    const batch = this.pending;
    this.pending = emptyPending();
    if (this.isEmpty(batch)) return;
    this.flushing = this.write(batch).finally(() => {
      this.flushing = null;
    });
    await this.flushing;
    if (!this.isEmpty(this.pending)) await this.flush();
  }

  private isEmpty(batch: Pending): boolean {
    return (
      batch.addStrokes.length +
        batch.updateStrokes.length +
        batch.deleteStrokes.size +
        batch.addTexts.length +
        batch.updateTexts.length +
        batch.deleteTexts.size +
        batch.addImages.length +
        batch.updateImages.length +
        batch.deleteImages.size ===
      0
    );
  }

  private async write(batch: Pending): Promise<void> {
    const stamp = now();
    const deviceId = await currentDeviceId();
    try {
      await db.transaction(
        'rw',
        [db.strokes, db.texts, db.images, db.outbox],
        async () => {
          if (batch.addStrokes.length > 0) {
            const rows = batch.addStrokes.map((s) => ({
              ...s,
              deviceId: s.deviceId || deviceId,
              updatedAt: stamp,
              version: Math.max(1, s.version),
            }));
            await db.strokes.bulkPut(rows);
            for (const row of rows) await markOutbox('stroke', row.id);
          }
          if (batch.updateStrokes.length > 0) {
            const rows = batch.updateStrokes.map((s) => ({
              ...s,
              deviceId: s.deviceId || deviceId,
              updatedAt: stamp,
              version: s.version + 1,
            }));
            await db.strokes.bulkPut(rows);
            for (const row of rows) await markOutbox('stroke', row.id);
          }
          if (batch.addTexts.length > 0) {
            const rows = batch.addTexts.map((t) => ({
              ...t,
              deviceId: t.deviceId || deviceId,
              updatedAt: stamp,
              version: Math.max(1, t.version),
            }));
            await db.texts.bulkPut(rows);
            for (const row of rows) await markOutbox('text', row.id);
          }
          if (batch.updateTexts.length > 0) {
            const rows = batch.updateTexts.map((t) => ({
              ...t,
              deviceId: t.deviceId || deviceId,
              updatedAt: stamp,
              version: t.version + 1,
            }));
            await db.texts.bulkPut(rows);
            for (const row of rows) await markOutbox('text', row.id);
          }
          if (batch.addImages.length > 0) {
            const rows = batch.addImages.map((i) => ({
              ...i,
              deviceId: i.deviceId || deviceId,
              updatedAt: stamp,
              version: Math.max(1, i.version),
            }));
            await db.images.bulkPut(rows);
            for (const row of rows) await markOutbox('image', row.id);
          }
          if (batch.updateImages.length > 0) {
            const rows = batch.updateImages.map((i) => ({
              ...i,
              deviceId: i.deviceId || deviceId,
              updatedAt: stamp,
              version: i.version + 1,
            }));
            await db.images.bulkPut(rows);
            for (const row of rows) await markOutbox('image', row.id);
          }
        },
      );

      for (const id of batch.deleteStrokes) await tombstone('stroke', id);
      for (const id of batch.deleteTexts) await tombstone('text', id);
      for (const id of batch.deleteImages) await tombstone('image', id);
    } catch (error) {
      console.error('Failed to persist page content', error);
      this.onChange();
    }
  }

  addStrokes(strokes: Stroke[]): void {
    this.pending.addStrokes.push(...strokes);
    this.queue();
  }

  updateStrokes(strokes: Stroke[]): void {
    this.pending.updateStrokes.push(...strokes);
    this.queue();
  }

  deleteStrokes(ids: string[]): void {
    for (const id of ids) this.pending.deleteStrokes.add(id);
    this.queue();
  }

  addTexts(texts: TextBlock[]): void {
    this.pending.addTexts.push(...texts);
    this.queue();
  }

  updateTexts(texts: TextBlock[]): void {
    this.pending.updateTexts.push(...texts);
    this.queue();
  }

  deleteTexts(ids: string[]): void {
    for (const id of ids) this.pending.deleteTexts.add(id);
    this.queue();
  }

  addImages(images: ImagePlacement[]): void {
    this.pending.addImages.push(...images);
    this.queue();
  }

  updateImages(images: ImagePlacement[]): void {
    this.pending.updateImages.push(...images);
    this.queue();
  }

  deleteImages(ids: string[]): void {
    for (const id of ids) this.pending.deleteImages.add(id);
    this.queue();
  }
}

async function tombstone(kind: 'stroke' | 'text' | 'image', id: string): Promise<void> {
  const t = now();
  if (kind === 'stroke') {
    const row = await db.strokes.get(id);
    if (!row) return;
    await db.strokes.put({ ...row, deletedAt: t, updatedAt: t, version: row.version + 1 });
  } else if (kind === 'text') {
    const row = await db.texts.get(id);
    if (!row) return;
    await db.texts.put({ ...row, deletedAt: t, updatedAt: t, version: row.version + 1 });
  } else {
    const row = await db.images.get(id);
    if (!row) return;
    await db.images.put({ ...row, deletedAt: t, updatedAt: t, version: row.version + 1 });
  }
  await markOutbox(kind, id);
}

async function currentDeviceId(): Promise<string> {
  const row = await db.syncState.get('deviceId');
  return typeof row?.value === 'string' ? row.value : '';
}

/** Adapter handed to the DrawingEngine. */
export function createPagePersistence(buffer: PageWriteBuffer): PagePersistence {
  return {
    addStrokes: (strokes) => buffer.addStrokes(strokes),
    updateStrokes: (strokes) => buffer.updateStrokes(strokes),
    deleteStrokes: (ids) => buffer.deleteStrokes(ids),
    addTexts: (texts) => buffer.addTexts(texts),
    updateTexts: (texts) => buffer.updateTexts(texts),
    deleteTexts: (ids) => buffer.deleteTexts(ids),
    addImages: (images) => buffer.addImages(images),
    updateImages: (images) => buffer.updateImages(images),
    deleteImages: (ids) => buffer.deleteImages(ids),
    notifyChange: () => buffer.flushSoon(),
  };
}
