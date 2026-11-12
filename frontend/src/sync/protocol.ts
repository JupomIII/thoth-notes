import type { SyncKind, SyncRecord } from '../storage/types';

export interface PushRequest {
  deviceId: string;
  records: SyncRecord[];
}

export interface PushResponse {
  accepted: { kind: SyncKind; id: string; version: number; updatedAt: number }[];
  conflicts: { kind: SyncKind; id: string; server: SyncRecord; client: SyncRecord }[];
  cursor: number;
  serverTime: number;
}

export interface ChangesResponse {
  records: SyncRecord[];
  cursor: number;
  hasMore: boolean;
}

export interface HealthResponse {
  ok: boolean;
  name: string;
  version: number;
  deviceName: string;
  time: number;
}

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: number;
}

export interface ImportResult {
  ok: boolean;
  inserted: number;
  updated: number;
  skipped: number;
  assets: number;
  errors: string[];
}

export const SYNC_PROTOCOL_VERSION = 1;
export const MAX_BATCH = 200;
