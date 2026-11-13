import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, Plus, RotateCcw, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { Envelope, GraphFunction, GraphObject, GraphPoint } from '../storage/types';
import {
  compileExpression,
  derivativeAt,
  drawPlot,
  findExtrema,
  findIntersections,
  findRoots,
  loadMathEngine,
  onMathEngineReady,
  type ExtraCurve,
  type PlotConfig,
} from './plot';
import { Button, Field, TextInput, Toggle } from '../components/ui';
import { MathView } from '../rich/MathView';

export type GraphDraft = Omit<GraphObject, keyof Envelope | 'pageId'>;

export const GRAPH_COLORS = ['#2f4a3e', '#8a4b3a', '#3b4f7a', '#9a7b32', '#6b4a6b'];

function blankFunction(index: number): GraphFunction {
  return {
    id: `fn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    expression: index === 0 ? 'x^2' : index === 1 ? 'sin(x)' : '',
    color: GRAPH_COLORS[index % GRAPH_COLORS.length]!,
    width: 2.4,
    dashed: false,
    visible: true,
  };
}

function defaultView() {
  return { xMin: -10, xMax: 10, yMin: -6.5, yMax: 6.5, gridStep: 1 };
}

export function GraphPanel({
  initial,
  onCommit,
  onClose,
}: {
  initial?: GraphObject | null;
  onCommit: (draft: GraphDraft) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<GraphDraft>(() => ({
    x: initial?.x ?? 0,
    y: initial?.y ?? 0,
    width: initial?.width ?? 620,
    height: initial?.height ?? 420,
    functions: initial ? initial.functions.map((fn) => ({ ...fn })) : [blankFunction(0)],
    points: initial ? initial.points.map((point) => ({ ...point })) : [],
    ...(initial
      ? {
          xMin: initial.xMin,
          xMax: initial.xMax,
          yMin: initial.yMin,
          yMax: initial.yMax,
          gridStep: initial.gridStep,
        }
      : defaultView()),
    showGrid: initial?.showGrid ?? true,
    showAxes: initial?.showAxes ?? true,
    showLegend: initial?.showLegend ?? true,
    showAxisLabels: initial?.showAxisLabels ?? true,
    title: initial?.title ?? '',
    background: initial?.background ?? null,
  }));
  const [analysis, setAnalysis] = useState(false);
  const [activeFunction, setActiveFunction] = useState(0);
  const [probeX, setProbeX] = useState('1');
  const [showTangent, setShowTangent] = useState(false);
  const [showDerivative, setShowDerivative] = useState(false);
  const [engineTick, setEngineTick] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panRef = useRef<{ x: number; y: number; xMin: number; xMax: number; yMin: number; yMax: number } | null>(null);

  useEffect(() => {
    void loadMathEngine();
    return onMathEngineReady(() => setEngineTick((tick) => tick + 1));
  }, []);

  const previewWidth = 720;
  const previewHeight = 460;

  const visibleFunctions = draft.functions.filter((fn) => fn.visible && fn.expression.trim().length > 0);
  const probeValue = Number(probeX);
  const probeValid = Number.isFinite(probeValue);
  const active = draft.functions[activeFunction] ?? draft.functions[0];

  const compiledActive = useMemo(
    () => (active ? compileExpression(active.expression) : null),
    // engineTick republishes the parsed function once mathjs has loaded
    [active, engineTick],
  );

  const tangent = useMemo(() => {
    if (!compiledActive || !probeValid) return null;
    const y0 = compiledActive.evaluate(probeValue);
    const slope = derivativeAt(compiledActive.evaluate, probeValue, draft.xMin, draft.xMax);
    if (y0 === null || slope === null) return null;
    return { y0, slope, intercept: y0 - slope * probeValue };
  }, [compiledActive, probeValid, probeValue, draft.xMin, draft.xMax]);

  const config: PlotConfig = useMemo(
    () => ({
      functions: draft.functions,
      points: draft.points,
      xMin: draft.xMin,
      xMax: draft.xMax,
      yMin: draft.yMin,
      yMax: draft.yMax,
      showGrid: draft.showGrid,
      showAxes: draft.showAxes,
      showLegend: draft.showLegend,
      showAxisLabels: draft.showAxisLabels,
      gridStep: draft.gridStep,
      title: draft.title,
      background: draft.background,
    }),
    [draft],
  );

  const extraCurves = useMemo<ExtraCurve[]>(() => {
    const curves: ExtraCurve[] = [];
    if (showDerivative && compiledActive && !compiledActive.error) {
      const h = Math.max(1e-6, (draft.xMax - draft.xMin) * 1e-4);
      const fn = compiledActive.evaluate;
      curves.push({
        label: "f′(x)",
        color: active?.color ?? '#2f4a3e',
        width: 1.4,
        dashed: true,
        sample: (x) => {
          const before = fn(x - h);
          const after = fn(x + h);
          return before === null || after === null ? null : (after - before) / (2 * h);
        },
      });
    }
    if (showTangent && tangent) {
      curves.push({
        label: 'tangent',
        color: '#9b4b3f',
        width: 1.5,
        dashed: true,
        sample: (x) => tangent.slope * x + tangent.intercept,
      });
    }
    return curves;
  }, [showDerivative, showTangent, tangent, compiledActive, active, draft.xMin, draft.xMax]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resolution = Math.min(2.5, window.devicePixelRatio || 1) * 1.3;
    const width = Math.round(previewWidth * resolution);
    const height = Math.round(previewHeight * resolution);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    drawPlot(ctx, config, { x: 0, y: 0, width, height }, { pixelRatio: resolution, fontSize: 11, extraCurves });
  }, [config, extraCurves, engineTick]);

  const roots = useMemo(
    () => (analysis && compiledActive && !compiledActive.error ? findRoots(compiledActive.evaluate, draft.xMin, draft.xMax) : []),
    [analysis, compiledActive, draft.xMin, draft.xMax],
  );
  const extrema = useMemo(
    () =>
      analysis && compiledActive && !compiledActive.error
        ? findExtrema(compiledActive.evaluate, draft.xMin, draft.xMax)
        : [],
    [analysis, compiledActive, draft.xMin, draft.xMax],
  );
  const intersections = useMemo(() => {
    if (!analysis || draft.functions.length < 2) return [];
    const a = compileExpression(draft.functions[0]?.expression ?? '');
    const b = compileExpression(draft.functions[1]?.expression ?? '');
    if (a.error || b.error) return [];
    return findIntersections(a.evaluate, b.evaluate, draft.xMin, draft.xMax);
  }, [analysis, draft.functions, draft.xMin, draft.xMax, engineTick]);

  function patch(next: Partial<GraphDraft>): void {
    setDraft((current) => ({ ...current, ...next }));
  }

  function updateFunction(index: number, change: Partial<GraphFunction>): void {
    setDraft((current) => ({
      ...current,
      functions: current.functions.map((fn, i) => (i === index ? { ...fn, ...change } : fn)),
    }));
  }

  function addPoint(point: GraphPoint): void {
    setDraft((current) => ({
      ...current,
      points: current.points.some(
        (existing) => Math.abs(existing.x - point.x) < 1e-3 && Math.abs(existing.y - point.y) < 1e-3,
      )
        ? current.points
        : [...current.points, point],
    }));
  }

  function zoom(factor: number): void {
    const cx = (draft.xMin + draft.xMax) / 2;
    const cy = (draft.yMin + draft.yMax) / 2;
    const halfX = ((draft.xMax - draft.xMin) / 2) * factor;
    const halfY = ((draft.yMax - draft.yMin) / 2) * factor;
    patch({ xMin: cx - halfX, xMax: cx + halfX, yMin: cy - halfY, yMax: cy + halfY });
  }

  return (
    <div className="animate-in absolute inset-x-0 bottom-0 z-40 flex max-h-[88dvh] flex-col overflow-hidden rounded-t-2xl border border-line bg-paper-raised shadow-float sm:inset-x-3 sm:bottom-3 sm:rounded-2xl lg:inset-x-auto lg:right-4 lg:top-16 lg:max-h-[calc(100dvh-9rem)] lg:w-[880px]">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <h2 className="font-serif text-[17px] text-ink">Graph</h2>
          <span className="hidden text-[11.5px] text-ink-muted sm:inline">
            {visibleFunctions.length} {visibleFunctions.length === 1 ? 'function' : 'functions'} · editable object
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" className="h-9 px-2 text-[13px]" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="h-9 px-3 text-[13px]"
            disabled={visibleFunctions.length === 0}
            onClick={() =>
              onCommit({
                ...draft,
                functions: draft.functions
                  .map((fn) => ({ ...fn, expression: fn.expression.trim() }))
                  .filter((fn) => fn.expression.length > 0),
              })
            }
          >
            {initial ? 'Update' : 'Insert'}
          </Button>
          <button
            type="button"
            aria-label="Close graph editor"
            onClick={onClose}
            className="ml-1 flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-paper-sunken"
          >
            <X size={17} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <div className="thin-scroll flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row">
        <div className="shrink-0 border-b border-line p-3 lg:w-[54%] lg:border-b-0 lg:border-r">
          <canvas
            ref={canvasRef}
            style={{ width: '100%', aspectRatio: `${previewWidth} / ${previewHeight}`, touchAction: 'none' }}
            className="rounded-lg border border-line bg-paper"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              panRef.current = {
                x: event.clientX,
                y: event.clientY,
                xMin: draft.xMin,
                xMax: draft.xMax,
                yMin: draft.yMin,
                yMax: draft.yMax,
              };
            }}
            onPointerMove={(event) => {
              const pan = panRef.current;
              if (!pan) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const dx = ((event.clientX - pan.x) / rect.width) * (pan.xMax - pan.xMin);
              const dy = ((event.clientY - pan.y) / rect.height) * (pan.yMax - pan.yMin);
              patch({
                xMin: pan.xMin - dx,
                xMax: pan.xMax - dx,
                yMin: pan.yMin + dy,
                yMax: pan.yMax + dy,
              });
            }}
            onPointerUp={() => {
              panRef.current = null;
            }}
            onPointerCancel={() => {
              panRef.current = null;
            }}
            onWheel={(event) => {
              event.preventDefault();
              zoom(Math.exp(event.deltaY * 0.0012));
            }}
          />
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <Button variant="secondary" className="h-8 px-2" onClick={() => zoom(0.8)} aria-label="Zoom in">
              <ZoomIn size={15} strokeWidth={1.8} />
            </Button>
            <Button variant="secondary" className="h-8 px-2" onClick={() => zoom(1.25)} aria-label="Zoom out">
              <ZoomOut size={15} strokeWidth={1.8} />
            </Button>
            <Button variant="ghost" className="h-8 px-2 text-[12px]" onClick={() => patch(defaultView())}>
              <RotateCcw size={14} strokeWidth={1.8} /> Reset view
            </Button>
            <Button
              variant={analysis ? 'secondary' : 'ghost'}
              className="ml-auto h-8 px-2 text-[12px]"
              onClick={() => setAnalysis(!analysis)}
            >
              {analysis ? 'Hide analysis' : 'Analyse'}
            </Button>
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-3 p-3">
          <div className="space-y-1.5">
            {draft.functions.map((fn, index) => (
              <div key={fn.id} className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label={`Change colour of function ${index + 1}`}
                  onClick={() =>
                    updateFunction(index, {
                      color: GRAPH_COLORS[(GRAPH_COLORS.indexOf(fn.color) + 1) % GRAPH_COLORS.length]!,
                    })
                  }
                  className="h-7 w-7 shrink-0 rounded-full border border-line"
                  style={{ background: fn.color }}
                />
                <div className="min-w-0 flex-1">
                  <TextInput
                    value={fn.expression}
                    onChange={(event) => updateFunction(index, { expression: event.target.value })}
                    placeholder={`f${index + 1}(x) = e.g. x^3 - 4x`}
                    className="h-10 font-mono text-[13.5px]"
                    aria-label={`Function ${index + 1}`}
                  />
                </div>
                <button
                  type="button"
                  aria-label={fn.visible ? 'Hide function' : 'Show function'}
                  onClick={() => updateFunction(index, { visible: !fn.visible })}
                  className="flex h-9 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-paper-sunken"
                >
                  {fn.visible ? <Eye size={15} strokeWidth={1.8} /> : <EyeOff size={15} strokeWidth={1.8} />}
                </button>
                <button
                  type="button"
                  aria-label="Dashed line"
                  onClick={() => updateFunction(index, { dashed: !fn.dashed })}
                  className="flex h-9 w-8 items-center justify-center rounded-md text-[11px] text-ink-muted hover:bg-paper-sunken"
                  style={{ opacity: fn.dashed ? 1 : 0.45 }}
                >
                  – –
                </button>
                <button
                  type="button"
                  aria-label="Remove function"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      functions: current.functions.filter((_, i) => i !== index),
                    }))
                  }
                  disabled={draft.functions.length === 1}
                  className="flex h-9 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-paper-sunken disabled:opacity-30"
                >
                  <Trash2 size={15} strokeWidth={1.8} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  functions: [...current.functions, blankFunction(current.functions.length)],
                }))
              }
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12.5px] text-accent-strong hover:bg-paper-sunken"
            >
              <Plus size={14} strokeWidth={2} /> Add function
            </button>
            <p className="px-2 text-[11.5px] leading-relaxed text-ink-muted">
              Supports polynomials, trigonometry, exponentials, logarithms, roots, absolute values and
              piecewise conditions, e.g. <code className="font-mono">piecewise(x&lt;0, -x, x&gt;=0, x)</code>.
            </p>
          </div>

          <details className="rounded-lg border border-line bg-paper px-3 py-2">
            <summary className="cursor-pointer text-[12.5px] font-medium text-ink-soft">Axes and grid</summary>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(
                [
                  ['xMin', 'x min'],
                  ['xMax', 'x max'],
                  ['yMin', 'y min'],
                  ['yMax', 'y max'],
                  ['gridStep', 'Grid step'],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label}>
                  <TextInput
                    value={String(draft[key])}
                    inputMode="decimal"
                    className="h-9 text-[13px]"
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isFinite(value)) patch({ [key]: value } as Partial<GraphDraft>);
                    }}
                  />
                </Field>
              ))}
              <div className="col-span-2">
                <Field label="Title">
                  <TextInput
                    value={draft.title}
                    onChange={(event) => patch({ title: event.target.value })}
                    placeholder="Optional caption"
                    className="h-9 text-[13px]"
                  />
                </Field>
              </div>
            </div>
            <div className="mt-1 divide-y divide-line">
              <Toggle checked={draft.showGrid} onChange={(value) => patch({ showGrid: value })} label="Grid" />
              <Toggle checked={draft.showAxes} onChange={(value) => patch({ showAxes: value })} label="Axes" />
              <Toggle checked={draft.showAxisLabels} onChange={(value) => patch({ showAxisLabels: value })} label="Axis labels" />
              <Toggle checked={draft.showLegend} onChange={(value) => patch({ showLegend: value })} label="Legend" />
            </div>
          </details>

          {analysis && (
            <div className="space-y-3 rounded-lg border border-line bg-paper px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={activeFunction}
                  onChange={(event) => setActiveFunction(Number(event.target.value))}
                  className="h-9 rounded-md border border-line bg-paper-raised px-2 text-[13px]"
                  aria-label="Function to analyse"
                >
                  {draft.functions.map((fn, index) => (
                    <option key={fn.id} value={index}>
                      f{index + 1}: {fn.expression.trim() || 'empty'}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-1">
                  <span className="text-[12.5px] text-ink-muted">x =</span>
                  <TextInput
                    value={probeX}
                    onChange={(event) => setProbeX(event.target.value)}
                    inputMode="decimal"
                    className="h-9 w-20 text-[13px]"
                    aria-label="Value of x"
                  />
                </div>
              </div>

              {compiledActive?.error && <p className="text-[12px] text-danger">{compiledActive.error}</p>}

              {compiledActive && !compiledActive.error && probeValid && (
                <div className="space-y-1 text-[13px] text-ink-soft">
                  <div>
                    f({probeValue}) ={' '}
                    <strong className="tabular-nums">
                      {compiledActive.evaluate(probeValue)?.toFixed(4) ?? 'undefined'}
                    </strong>
                  </div>
                  <div className="flex items-center gap-2">
                    <span>f′(x) =</span>
                    <strong className="tabular-nums">
                      {derivativeAt(compiledActive.evaluate, probeValue, draft.xMin, draft.xMax)?.toFixed(4) ?? '—'}
                    </strong>
                  </div>
                  {tangent && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span>Tangent:</span>
                      <MathView
                        latex={`y = ${tangent.slope.toFixed(2)}x ${tangent.intercept >= 0 ? '+' : '-'} ${Math.abs(tangent.intercept).toFixed(2)}`}
                        size={14}
                        display={false}
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-1.5">
                <Button variant="secondary" className="h-8 px-2 text-[12px]" onClick={() => setShowDerivative(!showDerivative)}>
                  {showDerivative ? 'Hide derivative' : 'Show derivative'}
                </Button>
                <Button
                  variant="secondary"
                  className="h-8 px-2 text-[12px]"
                  disabled={!tangent}
                  onClick={() => setShowTangent(!showTangent)}
                >
                  {showTangent ? 'Hide tangent' : 'Show tangent'}
                </Button>
              </div>

              {roots.length > 0 && (
                <div>
                  <div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-ink-muted">Roots</div>
                  <div className="flex flex-wrap gap-1.5">
                    {roots.map((root) => (
                      <button
                        key={root.x}
                        type="button"
                        onClick={() =>
                          addPoint({
                            id: `p-${Date.now()}-${root.x}`,
                            x: root.x,
                            y: root.y,
                            label: '',
                            color: '#9b4b3f',
                          })
                        }
                        className="rounded border border-line bg-paper-raised px-1.5 py-1 text-[11.5px] tabular-nums hover:border-line-strong"
                        title="Add as a point on the graph"
                      >
                        x = {root.x.toFixed(3)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {extrema.length > 0 && (
                <div>
                  <div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-ink-muted">Turning points</div>
                  <div className="flex flex-wrap gap-1.5">
                    {extrema.map((point) => (
                      <button
                        key={`${point.kind}-${point.x}`}
                        type="button"
                        onClick={() =>
                          addPoint({
                            id: `p-${Date.now()}-${point.x}`,
                            x: point.x,
                            y: point.y,
                            label: point.kind === 'min' ? 'min' : 'max',
                            color: '#3b4f7a',
                          })
                        }
                        className="rounded border border-line px-1.5 py-1 text-[11.5px] tabular-nums"
                      >
                        {point.kind} ({point.x.toFixed(2)}, {point.y.toFixed(2)})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {intersections.length > 0 && (
                <div>
                  <div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-ink-muted">
                    Intersections of f1 and f2
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {intersections.map((point) => (
                      <span key={point.x} className="rounded border border-line px-1.5 py-1 text-[11.5px] tabular-nums">
                        ({point.x.toFixed(2)}, {point.y.toFixed(2)})
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {draft.points.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12px] text-ink-muted">Points:</span>
                  {draft.points.map((point) => (
                    <button
                      key={point.id}
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          points: current.points.filter((existing) => existing.id !== point.id),
                        }))
                      }
                      className="rounded border border-line px-1.5 py-1 text-[11.5px] tabular-nums"
                    >
                      ({point.x.toFixed(2)}, {point.y.toFixed(2)}) ×
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
