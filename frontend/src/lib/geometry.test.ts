import { describe, expect, it } from 'vitest';
import {
  boundsOfPoints,
  pointInPolygon,
  polylineDistance,
  segmentDistance,
  simplifyPoints,
  zoomAround,
} from './geometry';
import type { StrokePoint } from '../storage/types';

function point(x: number, y: number, pressure = 0.5): StrokePoint {
  return { x, y, pressure, tiltX: 0, tiltY: 0, timestamp: 0 };
}

describe('geometry', () => {
  it('computes stroke bounds with padding', () => {
    const bounds = boundsOfPoints([point(10, 10), point(30, 20)], 2);
    expect(bounds).toEqual({ minX: 8, minY: 8, maxX: 32, maxY: 22 });
  });

  it('measures distance to a segment, not just to its ends', () => {
    expect(segmentDistance(5, 5, 0, 0, 10, 0)).toBeCloseTo(5);
    expect(polylineDistance([point(0, 0), point(10, 0), point(10, 10)], 9, 5)).toBeCloseTo(1);
  });

  it('detects points inside a lasso polygon', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon(5, 5, square)).toBe(true);
    expect(pointInPolygon(15, 5, square)).toBe(false);
  });

  it('simplifies dense input while keeping the endpoints', () => {
    const line = Array.from({ length: 60 }, (_, index) => point(index, 0));
    const simplified = simplifyPoints(line, 0.5);
    expect(simplified.length).toBe(2);
    expect(simplified[0]!.x).toBe(0);
    expect(simplified[1]!.x).toBe(59);
  });

  it('keeps the zoom anchor fixed under the fingers', () => {
    const view = { scale: 1, tx: 0, ty: 0 };
    const next = zoomAround(view, 2, 100, 100);
    expect(next.scale).toBe(2);
    // Document point under (100,100) stays at (100,100).
    expect(100 * next.scale + next.tx).toBeCloseTo(100);
    expect(100 * next.scale + next.ty).toBeCloseTo(100);
  });

  it('clamps zoom to the configured range', () => {
    expect(zoomAround({ scale: 1, tx: 0, ty: 0 }, 100, 0, 0).scale).toBe(8);
    expect(zoomAround({ scale: 1, tx: 0, ty: 0 }, 0.001, 0, 0).scale).toBe(0.2);
  });
});
