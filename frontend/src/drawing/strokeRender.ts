import { getStroke } from 'perfect-freehand';
import type { Stroke, StrokePoint } from '../storage/types';
import { shapeOutlinePath } from '../lib/geometry';
import { brushConfig } from './brushes';

/** Converts a perfect-freehand outline into a smooth filled path. */
export function outlineToPath(outline: number[][]): Path2D {
  const path = new Path2D();
  if (outline.length === 0) return path;
  const first = outline[0]!;
  path.moveTo(first[0]!, first[1]!);
  for (let i = 1; i < outline.length; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % outline.length]!;
    path.quadraticCurveTo(a[0]!, a[1]!, (a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2);
  }
  path.closePath();
  return path;
}

export function strokePath(points: StrokePoint[], tool: Stroke['tool'], width: number): Path2D {
  if (points.length === 0) return new Path2D();
  if (points.length === 1) {
    const p = points[0]!;
    const r = Math.max(0.4, (width * (0.35 + p.pressure * 0.65)) / 2);
    const path = new Path2D();
    path.arc(p.x, p.y, r, 0, Math.PI * 2);
    return path;
  }
  const cfg = brushConfig(tool, width, points);
  const input = points.map((p) => [p.x, p.y, Math.max(0.02, Math.min(1, p.pressure))] as [number, number, number]);
  const outline = getStroke(input, {
    size: cfg.size,
    thinning: cfg.thinning,
    smoothing: cfg.smoothing,
    streamline: cfg.streamline,
    simulatePressure: cfg.simulatePressure,
    start: { taper: cfg.taperStart * cfg.size, cap: cfg.cap },
    end: { taper: cfg.taperEnd * cfg.size, cap: cfg.cap },
    last: true,
  });
  return outlineToPath(outline);
}

export interface DrawStrokeOptions {
  /** Draw the vector shapes for shape-tool strokes. */
  includeShapes?: boolean;
}

/**
 * Paints one stroke onto a context whose transform is already in document
 * space. Kept allocation-light because it runs for every visible stroke on
 * every full repaint.
 */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  options: DrawStrokeOptions = {},
): void {
  if (stroke.points.length === 0) return;
  ctx.save();
  ctx.globalAlpha = stroke.opacity;
  ctx.fillStyle = stroke.color;
  ctx.strokeStyle = stroke.color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (stroke.shape) {
    const a = stroke.points[0]!;
    const b = stroke.points[stroke.points.length - 1]!;
    const path = shapeOutlinePath(stroke.shape, a, b);
    ctx.lineWidth = stroke.width;
    ctx.stroke(path);
    ctx.restore();
    return;
  }

  if (options.includeShapes === false) {
    ctx.restore();
    return;
  }

  if (stroke.tool === 'highlighter') {
    ctx.globalCompositeOperation = 'multiply';
  }

  const path = strokePath(stroke.points, stroke.tool, stroke.width);
  ctx.fill(path);

  if (stroke.tool === 'pencil') {
    // Graphite edge: a thin, lighter second pass softens the filled core.
    ctx.globalAlpha = stroke.opacity * 0.35;
    ctx.lineWidth = Math.max(0.5, stroke.width * 0.18);
    ctx.stroke(path);
  }
  ctx.restore();
}

/** Draws a stroke preview (in-flight input) with identical styling. */
export function drawLiveStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
): void {
  drawStroke(ctx, { ...stroke, opacity: stroke.opacity });
}
