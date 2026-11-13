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

/** Keeps server prose short and readable; FastAPI errors arrive as JSON. */
function cleanDetail(text: string): string {
  const trimmed = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  const readable = trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed;
  return /^[{\[]/.test(readable) ? '' : readable;
}

/**
 * One sentence a person can act on, instead of a status code and a stack trace.
 * Exported because it is the sync UI's vocabulary, not an implementation detail.
 */
export function describeHttpStatus(status: number, detail = ''): string {
  const extra = cleanDetail(detail);
  const withDetail = (base: string) => (extra ? `${base} ${extra}` : base);
  if (status === 400) return withDetail('The laptop could not read that request (HTTP 400).');
  if (status === 404) {
    return 'That address is not on the laptop (HTTP 404). Check the address and port shown in the server window.';
  }
  if (status === 409) return 'The laptop already holds a different copy of that item.';
  if (status === 413) return 'That item is too large for the laptop to accept.';
  if (status === 429) return 'The laptop is asking for a pause. Try again in a minute.';
  if (status >= 500) {
    return withDetail(
      `The laptop hit an error (HTTP ${status}). Try again, and restart the server window if it keeps happening.`,
    );
  }
  return withDetail(`The laptop answered HTTP ${status}.`);
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
    throw new SyncError('That pairing code has expired. Press Refresh code on the laptop, then type the new one.', 401, 'auth');
  }
  if (response.status === 429) {
    throw new SyncError('Too many attempts. Wait a minute, then use the current code on the laptop.', 429, 'auth');
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new SyncError(describeHttpStatus(response.status, text), response.status, 'server');
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

  /** Aborts rather than leaving a spinner up forever on a sleeping laptop. */
  private async send(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    if (!this.baseUrl) throw new SyncError('Server address is empty', null, 'config');
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { 'X-Thoth-Token': this.token, ...(init.headers ?? {}) },
      });
    } catch (error) {
      throw new SyncError(networkMessage(error), null, 'network');
    } finally {
      window.clearTimeout(timer);
    }
  }

  private async request<T>(path: string, init: RequestInit = {}, timeoutMs = 20000): Promise<T> {
    const response = await this.send(path, init, timeoutMs);
    if (response.status === 401 || response.status === 403) {
      throw new SyncError('The pairing token was rejected. Pair this iPad again from the laptop.', response.status, 'auth');
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new SyncError(describeHttpStatus(response.status, text), response.status, 'server');
    }
    return (await response.json()) as T;
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
    const response = await this.send(
      `/api/sync/assets/${id}`,
      { method: 'PUT', headers: { 'Content-Type': mime || 'application/octet-stream' }, body: blob },
      60000,
    );
    if (!response.ok) {
      throw new SyncError(describeHttpStatus(response.status), response.status, 'server');
    }
  }

  async downloadAsset(id: string): Promise<Blob> {
    const response = await this.send(`/api/sync/assets/${id}`, { method: 'GET' }, 60000);
    if (!response.ok) {
      throw new SyncError(describeHttpStatus(response.status), response.status, 'server');
    }
    return response.blob();
  }

  createBackup(): Promise<BackupInfo> {
    return this.request<BackupInfo>('/api/backup/create', { method: 'POST' }, 120000);
  }

  listBackups(): Promise<BackupInfo[]> {
    return this.request<BackupInfo[]>('/api/backup/list', { method: 'GET' });
  }

  async exportBackup(): Promise<Blob> {
    const response = await this.send('/api/backup/export', { method: 'GET' }, 120000);
    if (!response.ok) throw new SyncError(describeHttpStatus(response.status), response.status, 'server');
    return response.blob();
  }

  async importBackup(file: Blob): Promise<ImportResult> {
    const response = await this.send(
      '/api/backup/import',
      { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: file },
      120000,
    );
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new SyncError(describeHttpStatus(response.status, text), response.status, 'server');
    }
    return (await response.json()) as ImportResult;
  }

  async downloadBackup(name: string): Promise<Blob> {
    const response = await this.send(`/api/backup/download/${encodeURIComponent(name)}`, { method: 'GET' }, 120000);
    if (!response.ok) throw new SyncError(describeHttpStatus(response.status), response.status, 'server');
    return response.blob();
  }
}
