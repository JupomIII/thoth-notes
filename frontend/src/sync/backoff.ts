/**
 * Pacing for automatic sync.
 *
 * A laptop that is asleep, off the Wi-Fi or restarting fails every attempt in
 * the same way, so retrying at a fixed rhythm only costs battery. Failures back
 * off geometrically, a success resets the rhythm, and every delay carries mild
 * jitter so two iPads on one network do not retry in lockstep.
 */

export const SYNC_INTERVAL_MS = 45_000;
export const SYNC_MAX_BACKOFF_MS = 5 * 60_000;

export function retryDelay(failures: number, random: () => number = Math.random): number {
  if (!Number.isFinite(failures) || failures <= 0) return SYNC_INTERVAL_MS;
  const doublings = Math.min(Math.floor(failures), 6);
  const step = Math.min(SYNC_MAX_BACKOFF_MS, SYNC_INTERVAL_MS * 2 ** doublings);
  const jitter = 0.85 + random() * 0.3;
  return Math.round(step * jitter);
}
