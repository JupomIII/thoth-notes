import { describe, expect, it } from 'vitest';
import { splitStrokeAround } from './engine';
import type { Stroke, StrokePoint } from '../storage/types';

function strokeOf(points: { x: number; y: number }[]): Stroke {
  const pointsWithMeta: StrokePoint[] = points.map((p, index) => ({
    x: p.x,
    y: p.y,
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    timestamp: index * 8,
  }));
  return {
    id: 'original',
    pageId: 'page-1',
    tool: 'fountain',
    color: '#1f1d1a',
    width: 4,
    opacity: 1,
    points: pointsWithMeta,
    shape: null,
    createdAt: 1,
    updatedAt: 1,
    version: 1,
    deviceId: 'device',
    deletedAt: null,
  };
}

describe('partial erase', () => {
  it('splits a stroke into the surviving runs', () => {
    const stroke = strokeOf(
      Array.from({ length: 21 }, (_, x) => ({ x, y: 0 })),
    );
    const segments = splitStrokeAround(stroke, { x: 10, y: 0 }, 1.5);
    expect(segments.length).toBe(2);
    expect(segments[0]!.points.at(-1)!.x).toBeLessThan(9);
    expect(segments[1]!.points[0]!.x).toBeGreaterThan(11);
    // New ids prevent the original stroke from being overwritten.
    expect(new Set(segments.map((s) => s.id)).size).toBe(segments.length);
    expect(segments.every((s) => s.id !== 'original')).toBe(true);
  });

  it('drops a fully erased stroke', () => {
    const stroke = strokeOf([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(splitStrokeAround(stroke, { x: 0, y: 0 }, 5)).toHaveLength(0);
  });

  it('keeps both halves when erasing in the middle of a long stroke', () => {
    const stroke = strokeOf(
      Array.from({ length: 200 }, (_, index) => ({ x: index * 0.5, y: Math.sin(index / 12) * 10 })),
    );
    const segments = splitStrokeAround(stroke, { x: 50, y: 0 }, 2);
    expect(segments.length).toBeGreaterThanOrEqual(1);
  });
});
