import { useEffect, useRef, useState } from 'react';
import type { EquationPlacement, GraphObject, TableObject } from '../storage/types';
import type { RichKind } from '../storage/repo';
import { drawPlot, loadMathEngine, onMathEngineReady } from '../graph/plot';
import { MathView } from './MathView';
import { cx } from '../components/ui';

export interface RichObjects {
  equations: EquationPlacement[];
  graphs: GraphObject[];
  tables: TableObject[];
}

export type RichSelection = { kind: RichKind; id: string } | null;

interface DragState {
  kind: RichKind;
  id: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
  dx: number;
  dy: number;
}

const MIN_WIDTH = 120;

function objectSize(object: EquationPlacement | GraphObject | TableObject): { width: number; height: number } {
  if ('latex' in object) return { width: object.width, height: 0 };
  if ('functions' in object) return { width: object.width, height: object.height };
  return {
    width: object.colWidths.reduce((sum, value) => sum + value, 0),
    height: object.rowHeights.reduce((sum, value) => sum + value, 0),
  };
}

function GraphCanvas({ graph, viewScale }: { graph: GraphObject; viewScale: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [engineTick, setEngineTick] = useState(0);

  useEffect(() => {
    void loadMathEngine();
    return onMathEngineReady(() => setEngineTick((tick) => tick + 1));
  }, []);
  // Resolution follows the zoom so lines stay crisp, capped to protect memory.
  const resolution = Math.min(3, Math.max(1.5, viewScale * 1.6));

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const width = Math.max(1, Math.round(graph.width * resolution));
    const height = Math.max(1, Math.round(graph.height * resolution));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
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
      { x: 0, y: 0, width, height },
      { pixelRatio: resolution, fontSize: 11 },
    );
  }, [graph, resolution, engineTick]);

  return (
    <canvas
      ref={ref}
      style={{ width: graph.width, height: graph.height, display: 'block', borderRadius: 2 }}
    />
  );
}

function TableView({ table }: { table: TableObject }) {
  const width = table.colWidths.reduce((sum, value) => sum + value, 0);
  return (
    <table
      style={{
        width,
        borderCollapse: 'collapse',
        tableLayout: 'fixed',
        background: '#fffdfa',
        fontSize: table.fontSize,
        color: table.color,
      }}
    >
      <colgroup>
        {table.colWidths.map((value, index) => (
          <col key={index} style={{ width: value }} />
        ))}
      </colgroup>
      <tbody>
        {table.cells.map((row, rowIndex) => (
          <tr key={rowIndex} style={{ height: table.rowHeights[rowIndex] }}>
            {row.map((cell, colIndex) => (
              <td
                key={colIndex}
                style={{
                  border: `1px solid ${table.borderColor}`,
                  padding: '4px 8px',
                  textAlign: table.align,
                  fontWeight: table.headerRow && rowIndex === 0 ? 600 : 400,
                  background: table.headerRow && rowIndex === 0 ? 'rgba(31,29,26,0.045)' : undefined,
                  verticalAlign: 'middle',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                }}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Renders equations, graphs and tables in document space above the ink canvas.
 * Geometry follows the engine's view transform, so objects pan and zoom with
 * the page while staying crisp and editable.
 */
export function RichLayer({
  view,
  objects,
  interactive,
  selected,
  onSelect,
  onMove,
  onResize,
  onOpen,
}: {
  view: { scale: number; tx: number; ty: number };
  objects: RichObjects;
  interactive: boolean;
  selected: RichSelection;
  onSelect: (selection: RichSelection) => void;
  onMove: (kind: RichKind, id: string, x: number, y: number) => void;
  onResize: (kind: RichKind, id: string, width: number, height: number) => void;
  onOpen: (kind: RichKind, id: string) => void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (!drag) return;
    const onPointerMove = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const dx = (event.clientX - current.startX) / view.scale;
      const dy = (event.clientY - current.startY) / view.scale;
      const next = { ...current, dx, dy };
      dragRef.current = next;
      setDrag(next);
    };
    const onPointerUp = () => {
      const current = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!current) return;
      if (current.mode === 'move') {
        onMove(current.kind, current.id, current.originX + current.dx, current.originY + current.dy);
      } else {
        onResize(
          current.kind,
          current.id,
          Math.max(MIN_WIDTH, current.width + current.dx),
          Math.max(160, current.height + current.dy),
        );
      }
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [drag, view.scale, onMove, onResize]);

  const offsetFor = (kind: RichKind, id: string) => {
    if (!drag || drag.kind !== kind || drag.id !== id) return { dx: 0, dy: 0 };
    return { dx: drag.dx, dy: drag.dy };
  };

  function startInteraction(
    event: React.PointerEvent<HTMLElement>,
    kind: RichKind,
    object: EquationPlacement | GraphObject | TableObject,
    mode: 'move' | 'resize',
  ): void {
    if (!interactive) return;
    event.stopPropagation();
    event.preventDefault();
    onSelect({ kind, id: object.id });
    const size = objectSize(object);
    const state: DragState = {
      kind,
      id: object.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      originX: object.x,
      originY: object.y,
      width: size.width,
      height: size.height,
      dx: 0,
      dy: 0,
    };
    dragRef.current = state;
    setDrag(state);
  }

  const isSelected = (kind: RichKind, id: string) => selected?.kind === kind && selected.id === id;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
      onPointerDown={() => {
        if (interactive) onSelect(null);
      }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }}
      >
        {objects.tables.map((table) => {
          const offset = offsetFor('table', table.id);
          const size = objectSize(table);
          return (
            <div
              key={table.id}
              data-rich-object="table"
              className={cx(
                'absolute',
                interactive && 'pointer-events-auto cursor-move',
                isSelected('table', table.id) && 'outline outline-2 outline-offset-2 outline-accent',
              )}
              style={{ left: table.x + offset.dx, top: table.y + offset.dy, width: size.width }}
              onPointerDown={(event) => startInteraction(event, 'table', table, 'move')}
              onDoubleClick={() => onOpen('table', table.id)}
            >
              <TableView table={table} />
              {isSelected('table', table.id) && (
                <span
                  role="presentation"
                  className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-sm border border-accent bg-paper-raised"
                  onPointerDown={(event) => startInteraction(event, 'table', table, 'resize')}
                />
              )}
            </div>
          );
        })}

        {objects.graphs.map((graph) => {
          const offset = offsetFor('graph', graph.id);
          return (
            <div
              key={graph.id}
              data-rich-object="graph"
              className={cx(
                'absolute',
                interactive && 'pointer-events-auto cursor-move',
                isSelected('graph', graph.id) && 'outline outline-2 outline-offset-2 outline-accent',
              )}
              style={{ left: graph.x + offset.dx, top: graph.y + offset.dy }}
              onPointerDown={(event) => startInteraction(event, 'graph', graph, 'move')}
              onDoubleClick={() => onOpen('graph', graph.id)}
            >
              <GraphCanvas graph={graph} viewScale={view.scale} />
              {isSelected('graph', graph.id) && (
                <span
                  role="presentation"
                  className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-sm border border-accent bg-paper-raised"
                  onPointerDown={(event) => startInteraction(event, 'graph', graph, 'resize')}
                />
              )}
            </div>
          );
        })}

        {objects.equations.map((equation) => {
          const offset = offsetFor('equation', equation.id);
          return (
            <div
              key={equation.id}
              data-rich-object="equation"
              className={cx(
                'absolute select-none',
                interactive && 'pointer-events-auto cursor-move',
                isSelected('equation', equation.id) && 'outline outline-2 outline-offset-2 outline-accent',
              )}
              style={{
                left: equation.x + offset.dx,
                top: equation.y + offset.dy,
                width: equation.width,
                textAlign: equation.align,
                color: equation.color,
              }}
              onPointerDown={(event) => startInteraction(event, 'equation', equation, 'move')}
              onDoubleClick={() => onOpen('equation', equation.id)}
            >
              {equation.label ? (
                <div
                  style={{
                    fontSize: Math.max(10, Math.round(equation.fontSize * 0.62)),
                    color: equation.color,
                    opacity: 0.62,
                    marginBottom: 2,
                  }}
                >
                  {equation.label}
                </div>
              ) : null}
              <MathView latex={equation.latex} size={equation.fontSize} color={equation.color} display={false} />
              {isSelected('equation', equation.id) && (
                <span
                  role="presentation"
                  className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-sm border border-accent bg-paper-raised"
                  onPointerDown={(event) => startInteraction(event, 'equation', equation, 'resize')}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
