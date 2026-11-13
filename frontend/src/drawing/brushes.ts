import type { DrawToolId, StrokePoint } from '../storage/types';

export interface FreehandConfig {
  size: number;
  thinning: number;
  smoothing: number;
  streamline: number;
  taperStart: number;
  taperEnd: number;
  cap: boolean;
  simulatePressure: boolean;
}

const BASE: Record<string, Omit<FreehandConfig, 'size' | 'simulatePressure'>> = {
  fountain: {
    thinning: 0.74,
    smoothing: 0.55,
    streamline: 0.42,
    taperStart: 0.22,
    taperEnd: 0.32,
    cap: true,
  },
  ballpoint: {
    thinning: 0.36,
    smoothing: 0.5,
    streamline: 0.45,
    taperStart: 0.06,
    taperEnd: 0.1,
    cap: true,
  },
  pencil: {
    thinning: 0.28,
    smoothing: 0.38,
    streamline: 0.3,
    taperStart: 0.12,
    taperEnd: 0.18,
    cap: true,
  },
  highlighter: {
    thinning: 0.04,
    smoothing: 0.6,
    streamline: 0.7,
    taperStart: 0,
    taperEnd: 0,
    cap: true,
  },
};

export function averageTilt(points: StrokePoint[]): number {
  if (points.length === 0) return 0;
  let sum = 0;
  for (const p of points) {
    const t = Math.min(90, Math.hypot(p.tiltX || 0, p.tiltY || 0));
    sum += t / 90;
  }
  return sum / points.length;
}

export function hasRealPressure(points: StrokePoint[]): boolean {
  if (points.length < 3) return false;
  let min = 1;
  let max = 0;
  for (const p of points) {
    if (p.pressure < min) min = p.pressure;
    if (p.pressure > max) max = p.pressure;
  }
  return max - min > 0.02;
}

/**
 * Resolves the perfect-freehand configuration for a tool. Tilt widens the
 * graphite/pencil nib, which is the closest practical mapping of hardware tilt
 * that Safari exposes.
 */
export function brushConfig(tool: DrawToolId, width: number, points: StrokePoint[]): FreehandConfig {
  const base = BASE[tool] ?? BASE.ballpoint!;
  let size = width;
  if (tool === 'pencil') size = width * (1 + averageTilt(points) * 0.55);
  return {
    ...base,
    size,
    simulatePressure: !hasRealPressure(points),
  };
}

export const BRUSH_TOOLS: DrawToolId[] = ['fountain', 'ballpoint', 'pencil', 'highlighter'];
export const SHAPE_TOOLS: DrawToolId[] = ['line', 'rect', 'circle', 'ellipse', 'triangle', 'arrow'];

export const TOOL_LABELS: Record<DrawToolId, string> = {
  select: 'Select',
  fountain: 'Fountain pen',
  ballpoint: 'Ballpoint',
  pencil: 'Pencil',
  highlighter: 'Highlighter',
  eraser: 'Eraser',
  lasso: 'Lasso select',
  text: 'Text',
  image: 'Image',
  line: 'Line',
  rect: 'Rectangle',
  circle: 'Circle',
  ellipse: 'Ellipse',
  triangle: 'Triangle',
  arrow: 'Arrow',
};
