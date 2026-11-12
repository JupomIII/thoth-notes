export interface SyncStatus {
  phase: 'idle' | 'syncing' | 'success' | 'error' | 'offline' | 'unconfigured';
  message: string;
  lastSyncAt: number | null;
  pending: number;
  conflicts: number;
  online: boolean;
  dataVersion: number;
}

const initial: SyncStatus = {
  phase: 'unconfigured',
  message: 'No sync server configured',
  lastSyncAt: null,
  pending: 0,
  conflicts: 0,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  dataVersion: 0,
};

let state: SyncStatus = initial;
const listeners = new Set<() => void>();

export const syncStatus = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): SyncStatus {
    return state;
  },
  update(patch: Partial<SyncStatus>): void {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  },
  bumpDataVersion(): void {
    this.update({ dataVersion: state.dataVersion + 1 });
  },
};

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => syncStatus.update({ online: true }));
  window.addEventListener('offline', () => syncStatus.update({ online: false }));
}
