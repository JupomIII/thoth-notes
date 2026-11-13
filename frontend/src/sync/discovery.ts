import { normalizeServerUrl } from './client';
import type { HealthResponse } from './protocol';

/**
 * When the app is served by a Thoth backend, the page already belongs to a
 * machine: its origin *is* the server. That covers the laptop opening
 * https://localhost:8443 (or the LAN address), which used to mean typing the
 * same address into the pairing form by hand.
 *
 * On GitHub Pages there is nothing to detect. Probing guessed LAN addresses
 * would be a port scan from the browser, so the iPad keeps the QR code.
 */

export interface PageLocation {
  protocol: string;
  hostname: string;
  origin: string;
}

export interface DetectedServer {
  origin: string;
  deviceName: string;
}

/** Hosts that can only be the store the app came from, never the laptop. */
const STATIC_HOST = /(^|\.)(github\.io|githubusercontent\.com|pages\.dev|netlify\.app|vercel\.app|surge\.sh)$/i;
const PROBE_TIMEOUT_MS = 2500;

export function pageLocation(): PageLocation | null {
  if (typeof window === 'undefined' || !window.location) return null;
  const { protocol, hostname, origin } = window.location;
  if (!origin) return null;
  return { protocol, hostname, origin };
}

export function isServedByThoth(page: PageLocation | null = pageLocation()): boolean {
  if (!page) return false;
  if (page.protocol !== 'http:' && page.protocol !== 'https:') return false;
  return !STATIC_HOST.test(page.hostname);
}

/** The health payload is the one thing only a Thoth server answers. */
export function readHealth(payload: unknown): { deviceName: string } | null {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as Partial<HealthResponse>;
  if (body.ok !== true) return null;
  if (typeof body.version !== 'number' || typeof body.deviceName !== 'string') return null;
  return { deviceName: body.deviceName };
}

/** Six-character code, only readable on the laptop itself. */
export function readPairingCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = (payload as { code?: unknown }).code;
  if (typeof raw !== 'string') return null;
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{6}$/.test(code) ? code : null;
}

async function readJson(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    // A static server answers index.html to everything: that is not a server.
    if (!(response.headers.get('content-type') ?? '').includes('json')) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function detectLocalServer(
  page: PageLocation | null = pageLocation(),
): Promise<DetectedServer | null> {
  if (!page || !isServedByThoth(page)) return null;
  const health = readHealth(await readJson(`${page.origin}/api/health`));
  if (!health) return null;
  return { origin: normalizeServerUrl(page.origin), deviceName: health.deviceName };
}

export async function detectPairingCode(page: PageLocation | null = pageLocation()): Promise<string | null> {
  if (!page || !isServedByThoth(page)) return null;
  return readPairingCode(await readJson(`${page.origin}/api/pair/link`));
}

export type Adoption =
  | { kind: 'none' }
  | { kind: 'repoint'; serverUrl: string }
  | { kind: 'pair'; serverUrl: string; code: string };

/**
 * What to do with the pairing settings when the app turns out to be served by
 * a server. A pairing token is never dropped: it is only re-pointed at this
 * machine, which is what keeps a laptop working when its LAN address changes.
 */
export function planAdoption(
  config: { serverUrl: string; token: string },
  detected: DetectedServer | null,
  code: string | null,
): Adoption {
  if (!detected) return { kind: 'none' };
  const sameAddress = normalizeServerUrl(config.serverUrl) === detected.origin;
  if (config.token.trim()) {
    return sameAddress ? { kind: 'none' } : { kind: 'repoint', serverUrl: detected.origin };
  }
  if (code) return { kind: 'pair', serverUrl: detected.origin, code };
  return sameAddress ? { kind: 'none' } : { kind: 'repoint', serverUrl: detected.origin };
}
