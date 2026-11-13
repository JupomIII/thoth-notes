import type { StrokePoint, ShapeKind } from '../storage/types';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOfPoints(points: { x: number; y: number }[], pad = 0): Bounds {
  if (points.length === 0) return { minX: -pad, minY: -pad, maxX: pad, maxY: pad };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

export function pointInPolygon(px: number, py: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const intersects =
      a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y || 1e-9) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function segmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(px, py, ax, ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return distance(px, py, ax + t * dx, ay + t * dy);
}

/** Distance from a point to the polyline described by stroke points. */
export function polylineDistance(points: { x: number; y: number }[], px: number, py: number): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return distance(points[0]!.x, points[0]!.y, px, py);
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const d = segmentDistance(px, py, a.x, a.y, b.x, b.y);
    if (d < best) best = d;
  }
  return best;
}

export function zoomAround(
  view: { scale: number; tx: number; ty: number },
  factor: number,
  screenX: number,
  screenY: number,
  minScale = 0.2,
  maxScale = 8,
): { scale: number; tx: number; ty: number } {
  const scale = Math.min(maxScale, Math.max(minScale, view.scale * factor));
  const applied = scale / view.scale;
  return {
    scale,
    tx: screenX - (screenX - view.tx) * applied,
    ty: screenY - (screenY - view.ty) * applied,
  };
}

/** Ramer–Douglas–Peucker simplification, used before persisting dense input. */
export function simplifyPoints(points: StrokePoint[], tolerance = 0.35): StrokePoint[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    const a = points[start]!;
    const b = points[end]!;
    for (let i = start + 1; i < end; i++) {
      const p = points[i]!;
      const d = segmentDistance(p.x, p.y, a.x, a.y, b.x, b.y);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > tolerance && index > 0) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  const result: StrokePoint[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) result.push(points[i]!);
  return result;
}

export function shapeOutlinePath(kind: ShapeKind, a: StrokePoint, b: StrokePoint): Path2D {
  const path = new Path2D();
  const x0 = a.x;
  const y0 = a.y;
  const x1 = b.x;
  const y1 = b.y;
  switch (kind) {
    case 'line':
      path.moveTo(x0, y0);
      path.lineTo(x1, y1);
      break;
    case 'rect':
      path.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      break;
    case 'circle': {
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      path.ellipse(cx, cy, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
      break;
    }
    case 'ellipse': {
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      path.ellipse(cx, cy, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
      break;
    }
    case 'triangle': {
      const left = Math.min(x0, x1);
      const right = Math.max(x0, x1);
      const top = Math.min(y0, y1);
      const bottom = Math.max(y0, y1);
      path.moveTo((left + right) / 2, top);
      path.lineTo(right, bottom);
      path.lineTo(left, bottom);
      path.closePath();
      break;
    }
    case 'arrow': {
      path.moveTo(x0, y0);
      path.lineTo(x1, y1);
      const angle = Math.atan2(y1 - y0, x1 - x0);
      const head = Math.min(28, Math.max(10, Math.hypot(x1 - x0, y1 - y0) * 0.22));
      path.moveTo(x1, y1);
      path.lineTo(x1 - head * Math.cos(angle - Math.PI / 7), y1 - head * Math.sin(angle - Math.PI / 7));
      path.moveTo(x1, y1);
      path.lineTo(x1 - head * Math.cos(angle + Math.PI / 7), y1 - head * Math.sin(angle + Math.PI / 7));
      break;
    }
  }
  return path;
}

/** Rounds a point to the grid. */
export function snapToGrid(x: number, y: number, size: number): { x: number; y: number } {
  if (size <= 0) return { x, y };
  return { x: Math.round(x / size) * size, y: Math.round(y / size) * size };
}

/** Snaps the direction of a segment to the nearest step (default 15 degrees). */
export function snapAngle(
  from: { x: number; y: number },
  to: { x: number; y: number },
  stepDegrees = 15,
): { x: number; y: number } {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length < 1) return to;
  const step = (stepDegrees * Math.PI) / 180;
  const angle = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / step) * step;
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
}

export interface ShapeRecognition {
  kind: ShapeKind;
  start: StrokePoint;
  end: StrokePoint;
}

/**
 * Suggests a clean shape for a freehand stroke. It never edits anything by
 * itself: the caller offers the proposal and applies it only if accepted.
 */
export function recognizeShape(points: StrokePoint[]): ShapeRecognition | null {
  if (points.length < 8) return null;
  const bounds = boundsOfPoints(points);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const diagonal = Math.hypot(width, height);
  if (diagonal < 24) return null;

  const start: StrokePoint = { ...points[0]!, x: bounds.minX, y: bounds.minY };
  const end: StrokePoint = { ...points[0]!, x: bounds.maxX, y: bounds.maxY };
  const closed = distance(points[0]!.x, points[0]!.y, points[points.length - 1]!.x, points[points.length - 1]!.y) < diagonal * 0.24;

  // Straight line: every point stays close to the chord.
  if (!closed) {
    const chord = distance(points[0]!.x, points[0]!.y, points[points.length - 1]!.x, points[points.length - 1]!.y);
    if (chord < 40) return null;
    let maxDeviation = 0;
    for (const point of points) {
      const deviation = segmentDistance(point.x, point.y, points[0]!.x, points[0]!.y, points[points.length - 1]!.x, points[points.length - 1]!.y);
      if (deviation > maxDeviation) maxDeviation = deviation;
    }
    if (maxDeviation / chord < 0.055) {
      return {
        kind: 'line',
        start: { ...points[0]! },
        end: { ...points[points.length - 1]! },
      };
    }
    return null;
  }

  // Circle or ellipse: distance to the centre is stable.
  const cx = bounds.minX + width / 2;
  const cy = bounds.minY + height / 2;
  const radii = points.map((point) => Math.hypot((point.x - cx) / Math.max(1, width / 2), (point.y - cy) / Math.max(1, height / 2)));
  const mean = radii.reduce((sum, value) => sum + value, 0) / radii.length;
  const variance = radii.reduce((sum, value) => sum + (value - mean) ** 2, 0) / radii.length;
  const variation = Math.sqrt(variance) / Math.max(1e-6, mean);
  if (variation < 0.12) {
    const aspect = width / Math.max(1, height);
    return { kind: aspect > 1.28 || aspect < 0.78 ? 'ellipse' : 'circle', start, end };
  }

  // Rectangle: the outline hugs the bounding box (corners aside).
  let nearEdge = 0;
  const tolerance = Math.max(6, diagonal * 0.075);
  for (const point of points) {
    const dx = Math.min(Math.abs(point.x - bounds.minX), Math.abs(point.x - bounds.maxX));
    const dy = Math.min(Math.abs(point.y - bounds.minY), Math.abs(point.y - bounds.maxY));
    const nearCorner =
      Math.hypot(point.x - bounds.minX, point.y - bounds.minY) < tolerance * 1.8 ||
      Math.hypot(point.x - bounds.maxX, point.y - bounds.minY) < tolerance * 1.8 ||
      Math.hypot(point.x - bounds.minX, point.y - bounds.maxY) < tolerance * 1.8 ||
      Math.hypot(point.x - bounds.maxX, point.y - bounds.maxY) < tolerance * 1.8;
    if (nearCorner || dx < tolerance || dy < tolerance) nearEdge += 1;
  }
  if (nearEdge / points.length > 0.86) return { kind: 'rect', start, end };

  // Triangle: three dominant corners after simplification.
  const simplified = simplifyPoints(points, diagonal * 0.08);
  if (simplified.length === 3 || (simplified.length === 4 && closed)) {
    return { kind: 'triangle', start, end };
  }
  return null;
}
