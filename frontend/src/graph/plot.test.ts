import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileExpression,
  derivativeAt,
  findExtrema,
  findIntersections,
  findRoots,
  loadMathEngine,
  normalizeExpression,
} from './plot';

let parabola: (x: number) => number | null;

beforeAll(async () => {
  await loadMathEngine();
  // Compiled after the engine is ready: before that the parser reports null.
  parabola = compileExpression('x^2 - 4').evaluate;
});

describe('normalizeExpression', () => {
  it('drops a function prefix and keeps the body', () => {
    expect(normalizeExpression('f(x) = x^2')).toBe('x^2');
    expect(normalizeExpression('y = 2x + 3')).toBe('2x + 3');
  });

  it('rewrites LaTeX decorations into mathjs syntax', () => {
    expect(normalizeExpression('\\frac{1}{2}x')).toBe('((1)/(2))x');
    expect(normalizeExpression('\\sqrt{x}')).toBe('sqrt(x)');
    expect(normalizeExpression('\\sin(x)')).toBe('sin(x)');
    expect(normalizeExpression('x^{2}')).toBe('x^(2)');
  });
});

describe('compileExpression', () => {
  it('evaluates polynomials and trigonometry', () => {
    expect(compileExpression('x^3 - 4x').evaluate(2)).toBeCloseTo(0, 6);
    expect(compileExpression('sin(0)').evaluate(0)).toBeCloseTo(0, 6);
    expect(compileExpression('2x + 3').evaluate(4)).toBeCloseTo(11, 6);
  });

  it('supports piecewise definitions', () => {
    const fn = compileExpression('piecewise(x<0, -x, x>=0, x)').evaluate;
    expect(fn(-3)).toBeCloseTo(3, 6);
    expect(fn(2.5)).toBeCloseTo(2.5, 6);
  });

  it('reports a syntax error instead of throwing', () => {
    expect(compileExpression('x^^2').error).not.toBeNull();
    expect(compileExpression('x^^2').evaluate(1)).toBeNull();
  });

  it('never leaves the finite range silently', () => {
    expect(compileExpression('sqrt(x)').evaluate(-1)).toBeNull();
  });
});

describe('analysis', () => {
  it('finds roots inside the window', () => {
    const roots = findRoots(parabola, -5, 5).map((point) => point.x).sort((a, b) => a - b);
    expect(roots.length).toBeGreaterThanOrEqual(2);
    expect(roots[0]).toBeCloseTo(-2, 1);
    expect(roots[roots.length - 1]).toBeCloseTo(2, 1);
  });

  it('finds intersections between two curves', () => {
    const line = compileExpression('x + 2').evaluate;
    const hits = findIntersections(parabola, line, -5, 5).map((point) => point.x).sort((a, b) => a - b);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0]).toBeCloseTo(-2, 1);
    expect(hits[hits.length - 1]).toBeCloseTo(3, 1);
  });

  it('locates the minimum of a parabola', () => {
    const extrema = findExtrema(parabola, -5, 5);
    const minima = extrema.filter((point) => point.kind === 'min');
    expect(minima.length).toBeGreaterThan(0);
    expect(minima[0]!.x).toBeCloseTo(0, 1);
    expect(minima[0]!.y).toBeCloseTo(-4, 1);
  });

  it('differentiates numerically', () => {
    expect(derivativeAt(parabola, 1, -5, 5)).toBeCloseTo(2, 2);
    expect(derivativeAt(compileExpression('sin(x)').evaluate, 0, -5, 5)).toBeCloseTo(1, 2);
  });
});
