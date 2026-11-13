import { describe, expect, it } from 'vitest';
import { SYNC_INTERVAL_MS, SYNC_MAX_BACKOFF_MS, retryDelay } from './backoff';

const steady = () => 0.5; // 0.85 + 0.5 * 0.3 === 1, so the step is exact

describe('retryDelay', () => {
  it('keeps the normal rhythm after a success', () => {
    expect(retryDelay(0, steady)).toBe(SYNC_INTERVAL_MS);
    expect(retryDelay(-3, steady)).toBe(SYNC_INTERVAL_MS);
    expect(retryDelay(Number.NaN, steady)).toBe(SYNC_INTERVAL_MS);
  });

  it('doubles the wait for each failed attempt', () => {
    expect(retryDelay(1, steady)).toBe(SYNC_INTERVAL_MS * 2);
    expect(retryDelay(2, steady)).toBe(SYNC_INTERVAL_MS * 4);
    // 8 x 45 s would exceed the cap, so it levels off here.
    expect(retryDelay(3, steady)).toBe(SYNC_MAX_BACKOFF_MS);
  });

  it('never waits longer than the cap, however long the laptop stays away', () => {
    expect(retryDelay(20, steady)).toBe(SYNC_MAX_BACKOFF_MS);
    expect(retryDelay(999, steady)).toBe(SYNC_MAX_BACKOFF_MS);
  });

  it('spreads the delay so two iPads do not retry in lockstep', () => {
    const low = retryDelay(2, () => 0);
    const high = retryDelay(2, () => 0.999);
    expect(low).toBe(Math.round(SYNC_INTERVAL_MS * 4 * 0.85));
    expect(high).toBeLessThanOrEqual(Math.round(SYNC_INTERVAL_MS * 4 * 1.15));
    expect(high).toBeGreaterThan(low);
  });

  it('grows monotonically while attempts keep failing', () => {
    const delays = [0, 1, 2, 3, 4, 5].map((n) => retryDelay(n, steady));
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]!).toBeGreaterThanOrEqual(delays[i - 1]!);
    }
  });
});
