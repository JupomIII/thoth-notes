import { db } from './db';
import type { StoredAsset } from './types';
import { baseEnvelope, markOutbox } from './repo';
import { sha256Hex } from '../lib/hash';
import { now } from '../lib/id';

export interface AssetInput {
  kind: 'image' | 'pdf';
  mime: string;
  name: string;
  blob: Blob;
  pageCount?: number;
  id?: string;
  createdAt?: number;
}

/** Stores attachment bytes locally and queues their metadata for sync. */
export async function saveAsset(input: AssetInput): Promise<StoredAsset> {
  const bytes = new Uint8Array(await input.blob.arrayBuffer());
  const sha = await sha256Hex(bytes);
  const env = await baseEnvelope();
  const asset: StoredAsset = {
    ...env,
    ...(input.id ? { id: input.id } : {}),
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    kind: input.kind,
    mime: input.mime || input.blob.type || 'application/octet-stream',
    name: input.name,
    byteSize: bytes.byteLength,
    sha256: sha,
    pageCount: input.pageCount ?? 0,
    blob: input.blob,
  };
  await db.assets.put(asset);
  await markOutbox('asset', asset.id);
  return asset;
}

export async function saveImageAsset(file: File): Promise<StoredAsset> {
  return saveAsset({
    kind: 'image',
    mime: file.type || 'image/png',
    name: file.name || `image-${now()}`,
    blob: file,
  });
}
