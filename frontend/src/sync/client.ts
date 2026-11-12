import type {
  BackupInfo,
  ChangesResponse,
  HealthResponse,
  ImportResult,
  PairResponse,
  PushRequest,
  PushResponse,
  ServerStatus,
} from './protocol';

export class SyncError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly kind: 'network' | 'auth' | 'server' | 'config' = 'network',
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

/** Accepts "192.168.1.20:8443", "https://host:8443/" or a full path. */
export function normalizeServerUrl(raw: string): string {
  let value = raw.trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }
  value = value.replace(/\/+$/, '');
  return value;
}

function networkMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'The laptop did not answer in time. Is the server window still open?';
  }
  return 'Could not reach the laptop. Check the address, that both devices are on the same Wi-Fi, and that the certificate is trusted on this iPad.';
}

/** Pairing exchanges a six-character code for the long-lived token. */
export async function pairWithCode(
  rawUrl: string,
  code: string,
  deviceName: string,
): Promise<PairResponse> {
  const base = normalizeServerUrl(rawUrl);
  if (!base) throw new SyncError('Enter the laptop address first', null, 'config');
  let response: Response;
  try {
    response = await fetch(`${base}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, deviceName }),
    });
  } catch (error) {
    throw new SyncError(networkMessage(error), null, 'network');
  }
  if (response.status === 401) {
    throw new SyncError('That code has expired. Run scripts\\pair.ps1 on the laptop for a fresh one.', 401, 'auth');
  }
  if (response.status === 429) {
    throw new SyncError('Too many attempts. Restart the server window for a new code.', 429, 'auth');
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new SyncError(`The laptop answered ${response.status}${text ? `: ${text.slice(0, 140)}` : ''}`, response.status, 'server');
  }
  return (await response.json()) as PairResponse;
}

export class SyncClient {
  readonly baseUrl: string;

  constructor(
    rawUrl: string,
    private readonly token: string,
    private readonly deviceId: string,
  ) {
    this.baseUrl = normalizeServerUrl(rawUrl);
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    timeoutMs = 20000,
  ): Promise<T> {
    if (!this.baseUrl) throw new SyncError('Server address is empty', null, 'config');
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'X-Thoth-Token': this.token,
          ...(init.headers ?? {}),
        },
      });
      if (response.status === 401 || response.status === 403) {
        throw new SyncError('Pairing token rejected', response.status, 'auth');
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new SyncError(
          `Server responded ${response.status}${text ? `: ${text.slice(0, 180)}` : ''}`,
          response.status,
          'server',
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof SyncError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new SyncError('Server did not answer in time', null, 'network');
      }
      throw new SyncError(
        error instanceof Error ? error.message : 'Network request failed',
        null,
        'network',
      );
    } finally {
      window.clearTimeout(timer);
    }
  }

  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/api/health', { method: 'GET' }, 8000);
  }

  /** Where the notes actually land: laptop name, storage folder and counts. */
  status(): Promise<ServerStatus> {
    return this.request<ServerStatus>('/api/status', { method: 'GET' }, 8000);
  }

  push(records: PushRequest['records']): Promise<PushResponse> {
    const body: PushRequest = { deviceId: this.deviceId, records };
    return this.request<PushResponse>('/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  changes(since: number, limit = 400): Promise<ChangesResponse> {
    return this.request<ChangesResponse>(`/api/sync/changes?since=${since}&limit=${limit}`, {
      method: 'GET',
    });
  }

  async uploadAsset(id: string, blob: Blob, mime: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/sync/assets/${id}`, {
      method: 'PUT',
      headers: { 'X-Thoth-Token': this.token, 'Content-Type': mime || 'application/octet-stream' },
      body: blob,
    });
    if (!response.ok) {
      throw new SyncError(`Asset upload failed (${response.status})`, response.status, 'server');
    }
  }

  async downloadAsset(id: string): Promise<Blob> {
    const response = await fetch(`${this.baseUrl}/api/sync/assets/${id}`, {
      method: 'GET',
      headers: { 'X-Thoth-Token': this.token },
    });
    if (!response.ok) {
      throw new SyncError(`Asset download failed (${response.status})`, response.status, 'server');
    }
    return response.blob();
  }

  createBackup(): Promise<BackupInfo> {
    return this.request<BackupInfo>('/api/backup/create', { method: 'POST' }, 120000);
  }

  listBackups(): Promise<BackupInfo[]> {
    return this.request<BackupInfo[]>('/api/backup/list', { method: 'GET' });
  }

  exportBackup(): Promise<Blob> {
    return fetch(`${this.baseUrl}/api/backup/export`, {
      headers: { 'X-Thoth-Token': this.token },
    }).then((response) => {
      if (!response.ok) throw new SyncError(`Backup export failed (${response.status})`);
      return response.blob();
    });
  }

  async importBackup(file: Blob): Promise<ImportResult> {
    const response = await fetch(`${this.baseUrl}/api/backup/import`, {
      method: 'POST',
      headers: { 'X-Thoth-Token': this.token, 'Content-Type': 'application/zip' },
      body: file,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new SyncError(`Backup import failed (${response.status}) ${text.slice(0, 160)}`);
    }
    return (await response.json()) as ImportResult;
  }

  downloadBackup(name: string): Promise<Blob> {
    return fetch(`${this.baseUrl}/api/backup/download/${encodeURIComponent(name)}`, {
      headers: { 'X-Thoth-Token': this.token },
    }).then((response) => {
      if (!response.ok) throw new SyncError(`Backup download failed (${response.status})`);
      return response.blob();
    });
  }
}
