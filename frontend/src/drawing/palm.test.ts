import { describe, expect, it } from 'vitest';
import { PALM_GRACE_MS, isPenSession, shouldRejectTouch } from './palm';

const pen = (over: Partial<Parameters<typeof shouldRejectTouch>[0]> = {}) => ({
  palmRejection: true,
  penDown: false,
  sincePenUp: Number.POSITIVE_INFINITY,
  penSession: false,
  ...over,
});

describe('palm rejection', () => {
  it('keeps every touch as navigation when the setting is off', () => {
    expect(shouldRejectTouch(pen({ palmRejection: false, penDown: true }))).toBe(false);
    expect(shouldRejectTouch(pen({ palmRejection: false, sincePenUp: 5 }))).toBe(false);
  });

  it('rejects touches while the pencil is in contact', () => {
    expect(shouldRejectTouch(pen({ penDown: true }))).toBe(true);
  });

  it('rejects touches inside the grace window after the pencil lifts', () => {
    expect(shouldRejectTouch(pen({ sincePenUp: 0 }))).toBe(true);
    expect(shouldRejectTouch(pen({ sincePenUp: PALM_GRACE_MS - 1 }))).toBe(true);
    expect(shouldRejectTouch(pen({ sincePenUp: PALM_GRACE_MS }))).toBe(false);
  });

  it('lets a finger pan once the grace window has passed', () => {
    expect(shouldRejectTouch(pen({ sincePenUp: PALM_GRACE_MS + 1 }))).toBe(false);
  });

  it('treats every pencil session as owned, not just drawing', () => {
    for (const kind of ['draw', 'shape', 'erase', 'lasso', 'move', 'resize']) {
      expect(isPenSession(kind)).toBe(true);
      expect(shouldRejectTouch(pen({ penSession: isPenSession(kind) }))).toBe(true);
    }
    for (const kind of ['none', 'pan', 'pinch']) {
      expect(isPenSession(kind)).toBe(false);
      expect(shouldRejectTouch(pen({ penSession: isPenSession(kind) }))).toBe(false);
    }
  });

  it('does not treat a life without a pencil as palm activity', () => {
    expect(shouldRejectTouch(pen({ sincePenUp: -1 }))).toBe(false);
  });
});
