/**
 * Function plotting for the graphing calculator and for graph objects that live
 * on a page. Expressions are parsed and evaluated by mathjs — never with eval()
 * or the Function constructor — so a pasted "formula" can never run code.
 */

import type { GraphFunction, GraphPoint } from '../storage/types';


export interface PlotConfig {
  functions: GraphFunction[];
  points: GraphPoint[];
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  showGrid: boolean;
  showAxes: boolean;
  showLegend: boolean;
  showAxisLabels: boolean;
  gridStep: number;
  title: string;
  background: string | null;
}

export interface PlotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A curve that is not backed by a stored expression, such as a tangent line. */
export interface ExtraCurve {
  label: string;
  color: string;
  width: number;
  dashed: boolean;
  sample: (x: number) => number | null;
}

type Compiled = (x: number) => number | null;

/**
 * mathjs is a large dependency and the drawing engine must stay quick, so the
 * expression parser is loaded on demand. Until it arrives graphs simply draw
 * nothing; they repaint as soon as the engine reports ready.
 */
export interface MathEngine {
  compile(source: string): { evaluate(scope: Record<string, number>): unknown };
}

let engine: MathEngine | null = null;
let enginePromise: Promise<void> | null = null;
const engineListeners = new Set<() => void>();

export function loadMathEngine(): Promise<void> {
  if (engine) return Promise.resolve();
  if (!enginePromise) {
    enginePromise = import('mathjs/number').then((module) => {
      engine = module as unknown as MathEngine;
      for (const listener of [...engineListeners]) listener();
    });
  }
  return enginePromise;
}

export function onMathEngineReady(listener: () => void): () => void {
  engineListeners.add(listener);
  return () => {
    engineListeners.delete(listener);
  };
}

export function mathEngineReady(): boolean {
  return engine !== null;
}

const FONT = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
const UI_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

/* ------------------------------------------------------------------ */
/* Input handling                                                      */
/* ------------------------------------------------------------------ */

const LATEX_SYMBOLS: [RegExp, string][] = [
  [/\\left/g, ''],
  [/\\right/g, ''],
  [/\\cdot/g, '*'],
  [/\\times/g, '*'],
  [/\\div/g, '/'],
  [/\\pi/g, 'pi'],
  [/\\theta/g, 'theta'],
  [/\\alpha/g, 'alpha'],
  [/\\beta/g, 'beta'],
  [/\\ln/g, 'log'],
  [/\\log/g, 'log10'],
  [/\\sin/g, 'sin'],
  [/\\cos/g, 'cos'],
  [/\\tan/g, 'tan'],
  [/\\exp/g, 'exp'],
  [/\\infty/g, 'Infinity'],
  [/√/g, 'sqrt'],
  [/π/g, 'pi'],
  [/×/g, '*'],
  [/÷/g, '/'],
  [/−/g, '-'],
];

function stripFractions(input: string): string {
  let text = input;
  for (let guard = 0; guard < 20; guard++) {
    const match = /\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/.exec(text);
    if (!match) break;
    text = text.replace(match[0], `((${match[1]})/(${match[2]}))`);
  }
  return text;
}

function stripSqrt(input: string): string {
  let text = input;
  for (let guard = 0; guard < 20; guard++) {
    const match = /\\sqrt\s*\{([^{}]*)\}/.exec(text);
    if (!match) break;
    text = text.replace(match[0], `sqrt(${match[1]})`);
  }
  return text;
}

/** Turns |a - b| into abs(a - b) so absolute values work as typed. */
function convertAbsolute(input: string): string {
  let text = input;
  for (let guard = 0; guard < 20; guard++) {
    const start = text.indexOf('|');
    if (start === -1) break;
    const end = text.indexOf('|', start + 1);
    if (end === -1) break;
    const inner = text.slice(start + 1, end);
    text = `${text.slice(0, start)}abs(${inner})${text.slice(end + 1)}`;
  }
  return text;
}

/** Removes a "f(x) =" or "y =" prefix and tidies LaTeX decorations. */
export function normalizeExpression(raw: string): string {
  let text = raw.trim();
  text = text.replace(/^\s*(?:[a-zA-Z]\s*\(\s*x\s*\)|y|f)\s*=\s*/, '');
  text = stripFractions(text);
  text = stripSqrt(text);
  for (const [pattern, replacement] of LATEX_SYMBOLS) text = text.replace(pattern, replacement);
  text = text.replace(/\^\s*\{([^{}]*)\}/g, '^($1)');
  text = text.replace(/_/g, '');
  text = convertAbsolute(text);
  text = text.replace(/\b(sin|cos|tan|log|ln|sqrt|abs|exp|arcsin|arccos|arctan)\(/g, '$1(');
  return text.trim();
}

function splitTopLevel(input: string, separator = ','): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of input) {
    if (char === '(' || char === '[' || char === '{') depth += 1;
    if (char === ')' || char === ']' || char === '}') depth -= 1;
    if (char === separator && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim().length > 0) parts.push(current);
  return parts.map((part) => part.trim());
}

export interface CompiledFunction {
  evaluate: Compiled;
  error: string | null;
  source: string;
}

/** Compiles one expression once; the returned closure is cheap to sample. */
export function compileExpression(raw: string): CompiledFunction {
  const source = normalizeExpression(raw);
  if (!source) return { evaluate: () => null, error: null, source };

  const piecewise = /^piecewise\s*\(/i.exec(source);
  const parser = engine;
  if (!parser) {
    void loadMathEngine();
    return { evaluate: () => null, error: null, source };
  }
  try {
    if (piecewise) {
      const inner = source.slice(piecewise[0].length, -1);
      const chunks = splitTopLevel(inner);
      const pairs: {
        condition: ReturnType<MathEngine['compile']>;
        value: ReturnType<MathEngine['compile']>;
      }[] = [];
      for (let i = 0; i + 1 < chunks.length; i += 2) {
        pairs.push({ condition: parser.compile(chunks[i]!), value: parser.compile(chunks[i + 1]!) });
      }
      if (pairs.length === 0) return { evaluate: () => null, error: 'Piecewise needs condition and value pairs', source };
      return {
        source,
        error: null,
        evaluate: (x: number) => {
          for (const pair of pairs) {
            try {
              if (pair.condition.evaluate({ x })) {
                const value = pair.value.evaluate({ x });
                return toFinite(value);
              }
            } catch {
              continue;
            }
          }
          return null;
        },
      };
    }
    const compiled = parser.compile(source);
    return {
      source,
      error: null,
      evaluate: (x: number) => {
        try {
          return toFinite(compiled.evaluate({ x }));
        } catch {
          return null;
        }
      },
    };
  } catch (error) {
    return {
      source,
      error: error instanceof Error ? error.message : 'Expression not understood',
      evaluate: () => null,
    };
  }
}

function toFinite(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value && typeof value === 'object' && 're' in (value as object)) {
    const complex = value as { re: number; im: number };
    return Math.abs(complex.im) < 1e-9 ? complex.re : null;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Numeric analysis                                                    */
/* ------------------------------------------------------------------ */

export function sample(fn: Compiled, xMin: number, xMax: number, count: number): { x: number; y: number | null }[] {
  const points: { x: number; y: number | null }[] = [];
  const step = (xMax - xMin) / Math.max(1, count - 1);
  for (let i = 0; i < count; i++) {
    const x = xMin + step * i;
    points.push({ x, y: fn(x) });
  }
  return points;
}

function bisect(fn: Compiled, a: number, b: number, iterations = 48): number {
  let low = a;
  let high = b;
  let fa = fn(low);
  for (let i = 0; i < iterations; i++) {
    const mid = (low + high) / 2;
    const fm = fn(mid);
    if (fm === null || fa === null) break;
    if (Math.abs(fm) < 1e-10) return mid;
    if (fa * fm <= 0) {
      high = mid;
    } else {
      low = mid;
      fa = fm;
    }
  }
  return (low + high) / 2;
}

/** Roots found by sign changes on a fine grid, then refined by bisection. */
export function findRoots(fn: Compiled, xMin: number, xMax: number, limit = 12): { x: number; y: number }[] {
  const steps = 1400;
  const dx = (xMax - xMin) / steps;
  const roots: { x: number; y: number }[] = [];
  let previous = fn(xMin);
  for (let i = 1; i <= steps; i++) {
    const x = xMin + dx * i;
    const value = fn(x);
    if (value === null) {
      previous = null;
      continue;
    }
    if (value === 0) {
      roots.push({ x, y: 0 });
    } else if (previous !== null && previous * value < 0) {
      const root = bisect(fn, x - dx, x);
      const y = fn(root) ?? 0;
      roots.push({ x: root, y });
    }
    previous = value;
    if (roots.length >= limit) break;
  }
  return dedupe(roots);
}

function dedupe<T extends { x: number }>(items: T[], tolerance = 1e-4): T[] {
  const out: T[] = [];
  for (const item of items) {
    if (out.some((existing) => Math.abs(existing.x - item.x) < tolerance)) continue;
    out.push(item);
  }
  return out;
}

export function findIntersections(a: Compiled, b: Compiled, xMin: number, xMax: number): { x: number; y: number }[] {
  const difference: Compiled = (x: number) => {
    const ya = a(x);
    const yb = b(x);
    if (ya === null || yb === null) return null;
    return ya - yb;
  };
  return findRoots(difference, xMin, xMax).map(({ x }) => ({ x, y: a(x) ?? 0 }));
}

export function findExtrema(fn: Compiled, xMin: number, xMax: number): { x: number; y: number; kind: 'min' | 'max' }[] {
  const steps = 900;
  const dx = (xMax - xMin) / steps;
  const out: { x: number; y: number; kind: 'min' | 'max' }[] = [];
  for (let i = 1; i < steps; i++) {
    const x = xMin + dx * i;
    const left = fn(x - dx);
    const centre = fn(x);
    const right = fn(x + dx);
    if (left === null || centre === null || right === null) continue;
    if (centre < left && centre < right) {
      const refined = refineExtremum(fn, x - dx, x + dx, 'min');
      if (refined !== null) out.push({ ...refined, kind: 'min' });
    } else if (centre > left && centre > right) {
      const refined = refineExtremum(fn, x - dx, x + dx, 'max');
      if (refined !== null) out.push({ ...refined, kind: 'max' });
    }
  }
  return dedupe(out, 1e-3);
}

function refineExtremum(
  fn: Compiled,
  a: number,
  b: number,
  kind: 'min' | 'max',
): { x: number; y: number } | null {
  let low = a;
  let high = b;
  for (let i = 0; i < 60; i++) {
    const m1 = low + (high - low) / 3;
    const m2 = high - (high - low) / 3;
    const f1 = fn(m1);
    const f2 = fn(m2);
    if (f1 === null || f2 === null) return null;
    if (kind === 'min' ? f1 < f2 : f1 > f2) high = m2;
    else low = m1;
  }
  const x = (low + high) / 2;
  const y = fn(x);
  return y === null ? null : { x, y };
}

export function derivativeAt(fn: Compiled, x: number, xMin: number, xMax: number): number | null {
  const h = Math.max(1e-6, (xMax - xMin) * 1e-4);
  const before = fn(x - h);
  const after = fn(x + h);
  if (before === null || after === null) return null;
  return (after - before) / (2 * h);
}

export function tangentLine(
  fn: Compiled,
  x0: number,
  xMin: number,
  xMax: number,
): { x: number; y: number; slope: number; intercept: number } | null {
  const y0 = fn(x0);
  const slope = derivativeAt(fn, x0, xMin, xMax);
  if (y0 === null || slope === null) return null;
  return { x: x0, y: y0, slope, intercept: y0 - slope * x0 };
}

export function derivativeCurve(fn: Compiled, xMin: number, xMax: number): Compiled {
  return (x: number) => derivativeAt(fn, x, xMin, xMax);
}

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

function niceStep(span: number, target: number): number {
  const rough = span / Math.max(1, target);
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, rough))));
  const normalised = rough / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

function formatTick(value: number, step: number): string {
  if (Math.abs(value) < step / 1000) return '0';
  const decimals = Math.max(0, Math.min(4, -Math.floor(Math.log10(step))));
  return value.toFixed(decimals).replace(/\.0+$/, '');
}

function expressionLabel(fn: GraphFunction): string {
  const raw = fn.expression.replace(/\s+/g, ' ').trim();
  return raw.length > 26 ? `${raw.slice(0, 25)}…` : raw || 'f(x)';
}

export function drawPlot(
  ctx: CanvasRenderingContext2D,
  config: PlotConfig,
  rect: PlotRect,
  options: { pixelRatio?: number; fontSize?: number; showLegend?: boolean; extraCurves?: ExtraCurve[] } = {},
): void {
  const ratio = options.pixelRatio ?? 1;
  const baseFont = (options.fontSize ?? 12) * ratio;
  const { xMin, xMax, yMin, yMax } = config;
  const spanX = xMax - xMin || 1;
  const spanY = yMax - yMin || 1;
  const toX = (x: number) => rect.x + ((x - xMin) / spanX) * rect.width;
  const toY = (y: number) => rect.y + rect.height - ((y - yMin) / spanY) * rect.height;

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();

  ctx.fillStyle = config.background ?? '#fffdfa';
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

  const gridStep = config.gridStep > 0 ? config.gridStep : niceStep(Math.max(spanX, spanY), 8);
  const minor = gridStep;
  const major = gridStep * 5;

  if (config.showGrid) {
    ctx.strokeStyle = 'rgba(31, 29, 26, 0.08)';
    ctx.lineWidth = 1 * ratio;
    ctx.beginPath();
    for (let x = Math.ceil(xMin / minor) * minor; x <= xMax; x += minor) {
      const px = Math.round(toX(x)) + 0.5;
      ctx.moveTo(px, rect.y);
      ctx.lineTo(px, rect.y + rect.height);
    }
    for (let y = Math.ceil(yMin / minor) * minor; y <= yMax; y += minor) {
      const py = Math.round(toY(y)) + 0.5;
      ctx.moveTo(rect.x, py);
      ctx.lineTo(rect.x + rect.width, py);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(31, 29, 26, 0.16)';
    ctx.beginPath();
    for (let x = Math.ceil(xMin / major) * major; x <= xMax; x += major) {
      const px = Math.round(toX(x)) + 0.5;
      ctx.moveTo(px, rect.y);
      ctx.lineTo(px, rect.y + rect.height);
    }
    for (let y = Math.ceil(yMin / major) * major; y <= yMax; y += major) {
      const py = Math.round(toY(y)) + 0.5;
      ctx.moveTo(rect.x, py);
      ctx.lineTo(rect.x + rect.width, py);
    }
    ctx.stroke();
  }

  if (config.showAxes) {
    ctx.strokeStyle = 'rgba(31, 29, 26, 0.55)';
    ctx.lineWidth = 1.2 * ratio;
    ctx.beginPath();
    if (yMin <= 0 && yMax >= 0) {
      const py = Math.round(toY(0)) + 0.5;
      ctx.moveTo(rect.x, py);
      ctx.lineTo(rect.x + rect.width, py);
    }
    if (xMin <= 0 && xMax >= 0) {
      const px = Math.round(toX(0)) + 0.5;
      ctx.moveTo(px, rect.y);
      ctx.lineTo(px, rect.y + rect.height);
    }
    ctx.stroke();

    ctx.fillStyle = 'rgba(31, 29, 26, 0.62)';
    ctx.font = `${baseFont}px ${UI_FONT}`;
    ctx.textBaseline = 'top';
    const labelStep = gridStep > 0 ? gridStep : niceStep(Math.max(spanX, spanY), 8);
    const axisY = yMin <= 0 && yMax >= 0 ? toY(0) : rect.y + rect.height;
    for (let x = Math.ceil(xMin / labelStep) * labelStep; x <= xMax; x += labelStep) {
      if (Math.abs(x) < labelStep / 1000) continue;
      ctx.fillText(formatTick(x, labelStep), toX(x) + 3 * ratio, Math.min(rect.y + rect.height - baseFont - 2, axisY + 3 * ratio));
    }
    const axisX = xMin <= 0 && xMax >= 0 ? toX(0) : rect.x;
    ctx.textAlign = 'right';
    for (let y = Math.ceil(yMin / labelStep) * labelStep; y <= yMax; y += labelStep) {
      if (Math.abs(y) < labelStep / 1000) continue;
      ctx.fillText(formatTick(y, labelStep), Math.max(rect.x + 22 * ratio, axisX - 4 * ratio), toY(y) - baseFont * 0.6);
    }
    ctx.textAlign = 'left';
  }

  if (config.showAxisLabels) {
    ctx.fillStyle = 'rgba(31, 29, 26, 0.6)';
    ctx.font = `italic ${baseFont * 1.05}px ${FONT}`;
    ctx.fillText('x', rect.x + rect.width - 12 * ratio, Math.min(rect.y + rect.height - 6 * ratio, (yMin <= 0 && yMax >= 0 ? toY(0) : rect.y + rect.height) - 6 * ratio));
    ctx.fillText('y', (xMin <= 0 && xMax >= 0 ? toX(0) : rect.x) + 6 * ratio, rect.y + baseFont);
  }

  const columns = Math.max(40, Math.min(2200, Math.round(rect.width)));

  const drawCurve = (
    sample: (x: number) => number | null,
    style: { color: string; width: number; dashed: boolean },
  ): void => {
    ctx.beginPath();
    ctx.strokeStyle = style.color;
    ctx.lineWidth = Math.max(0.6, style.width * ratio);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (style.dashed) ctx.setLineDash([style.width * 2.4 * ratio, style.width * 2 * ratio]);
    else ctx.setLineDash([]);
    let penDown = false;
    let previousY: number | null = null;
    const step = (xMax - xMin) / columns;
    for (let i = 0; i <= columns; i++) {
      const x = xMin + step * i;
      const y = sample(x);
      if (y === null || !Number.isFinite(y) || Math.abs(y) > 1e6) {
        penDown = false;
        previousY = null;
        continue;
      }
      const px = toX(x);
      const py = toY(y);
      const jump = previousY !== null ? Math.abs(py - previousY) : 0;
      if (!penDown || jump > rect.height * 0.9) {
        ctx.moveTo(px, py);
        penDown = true;
      } else {
        ctx.lineTo(px, py);
      }
      previousY = py;
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };

  for (const fn of config.functions) {
    if (!fn.visible) continue;
    const compiled = compileExpression(fn.expression);
    if (compiled.error) continue;
    drawCurve(compiled.evaluate, { color: fn.color, width: fn.width, dashed: fn.dashed });
  }

  for (const curve of options.extraCurves ?? []) {
    drawCurve(curve.sample, curve);
  }

  for (const point of config.points) {
    const px = toX(point.x);
    const py = toY(point.y);
    ctx.beginPath();
    ctx.fillStyle = point.color;
    ctx.arc(px, py, 3.2 * ratio, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fffdfa';
    ctx.lineWidth = 1.2 * ratio;
    ctx.stroke();
    if (point.label) {
      ctx.fillStyle = point.color;
      ctx.font = `${baseFont * 0.92}px ${UI_FONT}`;
      ctx.fillText(point.label, px + 6 * ratio, py - 5 * ratio);
    }
  }

  if (config.title) {
    ctx.fillStyle = 'rgba(31, 29, 26, 0.72)';
    ctx.font = `${baseFont * 1.05}px ${UI_FONT}`;
    ctx.fillText(config.title, rect.x + 8 * ratio, rect.y + 6 * ratio);
  }

  if (config.showLegend && options.showLegend !== false) {
    const items: { label: string; color: string; width: number; dashed: boolean }[] = [
      ...config.functions
        .filter((fn) => fn.visible)
        .map((fn) => ({
          label: expressionLabel(fn),
          color: fn.color,
          width: fn.width,
          dashed: fn.dashed,
        })),
      ...(options.extraCurves ?? []).map((curve) => ({
        label: curve.label,
        color: curve.color,
        width: curve.width,
        dashed: curve.dashed,
      })),
    ];
    if (items.length > 0) {
      const lineHeight = baseFont * 1.5;
      const padding = 6 * ratio;
      ctx.font = `${baseFont * 0.92}px ${UI_FONT}`;
      let width = 0;
      for (const item of items) width = Math.max(width, ctx.measureText(item.label).width);
      const boxWidth = width + 26 * ratio + padding * 2;
      const boxHeight = items.length * lineHeight + padding * 1.4;
      const boxX = rect.x + rect.width - boxWidth - 8 * ratio;
      const boxY = rect.y + 8 * ratio;
      ctx.fillStyle = 'rgba(255, 253, 250, 0.9)';
      ctx.strokeStyle = 'rgba(31, 29, 26, 0.12)';
      ctx.lineWidth = 1 * ratio;
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 6 * ratio);
      ctx.fill();
      ctx.stroke();
      items.forEach((item, index) => {
        const y = boxY + padding + lineHeight * index + lineHeight / 2;
        ctx.strokeStyle = item.color;
        ctx.lineWidth = Math.max(1, item.width * ratio);
        if (item.dashed) ctx.setLineDash([4 * ratio, 3 * ratio]);
        ctx.beginPath();
        ctx.moveTo(boxX + padding, y);
        ctx.lineTo(boxX + padding + 14 * ratio, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(31, 29, 26, 0.82)';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.label, boxX + padding + 19 * ratio, y);
        ctx.textBaseline = 'top';
      });
    }
  }

  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(31, 29, 26, 0.14)';
  ctx.lineWidth = 1 * ratio;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
  ctx.restore();
}

/** Convenience for graph objects stored on a page. */
export function drawGraphObject(
  ctx: CanvasRenderingContext2D,
  graph: {
    x: number;
    y: number;
    width: number;
    height: number;
    functions: GraphFunction[];
    points: GraphPoint[];
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    showGrid: boolean;
    showAxes: boolean;
    showLegend: boolean;
    showAxisLabels: boolean;
    gridStep: number;
    title: string;
    background: string | null;
  },
  scale = 1,
): void {
  drawPlot(
    ctx,
    {
      functions: graph.functions,
      points: graph.points,
      xMin: graph.xMin,
      xMax: graph.xMax,
      yMin: graph.yMin,
      yMax: graph.yMax,
      showGrid: graph.showGrid,
      showAxes: graph.showAxes,
      showLegend: graph.showLegend,
      showAxisLabels: graph.showAxisLabels,
      gridStep: graph.gridStep,
      title: graph.title,
      background: graph.background,
    },
    { x: graph.x, y: graph.y, width: graph.width, height: graph.height },
    { pixelRatio: scale, fontSize: 11 },
  );
}
