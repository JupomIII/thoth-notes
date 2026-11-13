import { useRef, useState } from 'react';
import {
  ArrowUpRight,
  ChevronDown,
  Circle,
  CircleDashed,
  Eraser,
  GripHorizontal,
  Highlighter,
  Image as ImageIcon,
  Lasso,
  Minus,
  MousePointer2,
  Pencil,
  PenTool,
  Redo2,
  Square,
  Triangle,
  Trash2,
  Type,
  Undo2,
  Copy,
  ClipboardPaste,
} from 'lucide-react';
import type { DrawToolId, ToolSettings } from '../storage/types';
import { IconButton, cx } from './ui';

const COLORS = ['#1f1d1a', '#23324a', '#4a6156', '#7d3f3f', '#b08a3e', '#6a4a62'];

const TOOLS: { id: DrawToolId; label: string; icon: typeof PenTool }[] = [
  { id: 'select', label: 'Select objects', icon: MousePointer2 },
  { id: 'fountain', label: 'Fountain pen', icon: PenTool },
  { id: 'ballpoint', label: 'Ballpoint pen', icon: PenTool },
  { id: 'pencil', label: 'Pencil', icon: Pencil },
  { id: 'highlighter', label: 'Highlighter', icon: Highlighter },
  { id: 'eraser', label: 'Eraser', icon: Eraser },
  { id: 'lasso', label: 'Lasso select', icon: Lasso },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'image', label: 'Insert image', icon: ImageIcon },
];

const SHAPES: { id: DrawToolId; label: string; icon: typeof Minus }[] = [
  { id: 'line', label: 'Straight line', icon: Minus },
  { id: 'rect', label: 'Rectangle', icon: Square },
  { id: 'circle', label: 'Circle', icon: Circle },
  { id: 'ellipse', label: 'Ellipse', icon: CircleDashed },
  { id: 'triangle', label: 'Triangle', icon: Triangle },
  { id: 'arrow', label: 'Arrow', icon: ArrowUpRight },
];

export interface ToolbarState {
  tool: DrawToolId;
  settings: ToolSettings;
  canUndo: boolean;
  canRedo: boolean;
  selectionCount: number;
  hasClipboard: boolean;
  collapsed: boolean;
  position: { x: number; y: number } | null;
}

export interface ToolbarActions {
  setTool(tool: DrawToolId): void;
  setSettings(settings: ToolSettings): void;
  undo(): void;
  redo(): void;
  deleteSelection(): void;
  copySelection(): void;
  paste(): void;
  toggleCollapse(): void;
  moveTo(position: { x: number; y: number } | null): void;
  openSettings(): void;
}

function widthRange(tool: DrawToolId): { min: number; max: number; step: number } {
  if (tool === 'highlighter') return { min: 8, max: 64, step: 1 };
  if (tool === 'eraser') return { min: 6, max: 80, step: 1 };
  return { min: 0.8, max: 24, step: 0.2 };
}

export function Toolbar({ state, actions }: { state: ToolbarState; actions: ToolbarActions }) {
  const [shapeMenu, setShapeMenu] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const { tool, settings } = state;
  const isShapeTool = SHAPES.some((shape) => shape.id === tool);
  const brush = isShapeTool || tool === 'line'
    ? settings[tool as 'line' | 'rect' | 'circle' | 'arrow']
    : tool === 'highlighter' || tool === 'eraser'
      ? null
      : settings[tool as 'fountain' | 'ballpoint' | 'pencil' | 'lasso' | 'text'];
  const activeColor = brush && 'color' in brush ? brush.color : settings[tool === 'eraser' ? 'fountain' : 'fountain'].color;
  const activeWidth = tool === 'eraser' ? settings.eraser.width : brush && 'width' in brush ? brush.width : 3;

  function update<T extends keyof ToolSettings>(key: T, patch: Partial<ToolSettings[T]>): void {
    actions.setSettings({
      ...settings,
      [key]: { ...(settings[key] as object), ...patch } as ToolSettings[T],
    });
  }

  function applyColor(color: string): void {
    if (tool === 'eraser') return;
    if (isShapeTool) update(tool as 'line' | 'rect' | 'circle' | 'arrow', { color });
    else if (tool === 'text') update('text', { color });
    else if (tool === 'lasso') update('fountain', { color });
    else update(tool as 'fountain' | 'ballpoint' | 'pencil' | 'highlighter', { color });
  }

  function applyWidth(width: number): void {
    if (tool === 'eraser') {
      update('eraser', { width });
      return;
    }
    if (isShapeTool) update(tool as 'line' | 'rect' | 'circle' | 'arrow', { width });
    else if (tool === 'text') {
      update('text', { fontSize: width + 14 });
      return;
    } else if (tool === 'lasso') return;
    else update(tool as 'fountain' | 'ballpoint' | 'pencil' | 'highlighter', { width });
  }

  function startDrag(event: React.PointerEvent<HTMLDivElement>): void {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onDrag(event: React.PointerEvent<HTMLDivElement>): void {
    if (!dragRef.current || !barRef.current) return;
    const parent = barRef.current.offsetParent as HTMLElement | null;
    const bounds = parent?.getBoundingClientRect();
    const width = barRef.current.offsetWidth;
    const height = barRef.current.offsetHeight;
    const maxX = (bounds?.width ?? window.innerWidth) - width - 8;
    const maxY = (bounds?.height ?? window.innerHeight) - height - 8;
    const x = Math.min(Math.max(8, event.clientX - (bounds?.left ?? 0) - dragRef.current.dx), Math.max(8, maxX));
    const y = Math.min(Math.max(8, event.clientY - (bounds?.top ?? 0) - dragRef.current.dy), Math.max(8, maxY));
    actions.moveTo({ x, y });
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>): void {
    if (dragRef.current) {
      dragRef.current = null;
      try {
        (event.target as HTMLElement).releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    }
  }

  const positionStyle = state.position
    ? { left: state.position.x, top: state.position.y }
    : { left: '50%', bottom: 'max(1rem, var(--safe-bottom))', transform: 'translateX(-50%)' };

  if (state.collapsed) {
    return (
      <div className="absolute z-30" style={positionStyle}>
        <button
          type="button"
          onClick={actions.toggleCollapse}
          className="flex h-11 items-center gap-2 rounded-full border border-line bg-paper-raised px-4 text-[13px] text-ink shadow-float"
        >
          <PenTool size={16} strokeWidth={1.8} />
          Tools
        </button>
      </div>
    );
  }

  return (
    <div
      ref={barRef}
      className="absolute z-30 select-none rounded-2xl border border-line bg-paper-raised/97 shadow-float backdrop-blur"
      style={positionStyle}
    >
      <div className="flex flex-wrap items-center gap-0.5 px-2 pt-1.5">
        <div
          onPointerDown={startDrag}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          className="mr-1 flex h-8 w-7 cursor-grab touch-none items-center justify-center text-ink-faint"
          title="Drag to reposition"
        >
          <GripHorizontal size={15} strokeWidth={1.8} />
        </div>

        {TOOLS.map((item) => (
          <IconButton
            key={item.id}
            label={item.label}
            active={tool === item.id}
            onClick={() => actions.setTool(item.id)}
            className="h-9 w-9"
          >
            <item.icon size={18} strokeWidth={1.7} />
          </IconButton>
        ))}

        <div className="relative">
          <button
            type="button"
            onClick={() => setShapeMenu(!shapeMenu)}
            aria-label="Shapes"
            className={cx(
              'flex h-9 items-center gap-0.5 rounded-lg px-2',
              isShapeTool ? 'bg-accent text-paper-raised' : 'text-ink-soft hover:bg-paper-sunken',
            )}
          >
            <Square size={17} strokeWidth={1.7} />
            <ChevronDown size={13} strokeWidth={2} />
          </button>
          {shapeMenu && (
            <div className="absolute bottom-11 left-0 z-40 flex gap-1 rounded-lg border border-line bg-paper-raised p-1 shadow-float">
              {SHAPES.map((shape) => (
                <IconButton
                  key={shape.id}
                  label={shape.label}
                  active={tool === shape.id}
                  className="h-9 w-9"
                  onClick={() => {
                    actions.setTool(shape.id);
                    setShapeMenu(false);
                  }}
                >
                  <shape.icon size={17} strokeWidth={1.7} />
                </IconButton>
              ))}
            </div>
          )}
        </div>

        <div className="mx-1 h-6 w-px bg-line" />

        <IconButton label="Undo" onClick={actions.undo} disabled={!state.canUndo} className="h-9 w-9">
          <Undo2 size={18} strokeWidth={1.7} />
        </IconButton>
        <IconButton label="Redo" onClick={actions.redo} disabled={!state.canRedo} className="h-9 w-9">
          <Redo2 size={18} strokeWidth={1.7} />
        </IconButton>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-t border-line px-2 py-1.5">
        <div className="flex items-center gap-1">
          {COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Colour ${color}`}
              onClick={() => applyColor(color)}
              className={cx(
                'h-6 w-6 rounded-full border-2',
                activeColor === color ? 'border-ink' : 'border-transparent',
              )}
              style={{ background: color }}
            />
          ))}
          <label className="relative ml-0.5 h-6 w-6 cursor-pointer overflow-hidden rounded-full border border-line-strong bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]">
            <input
              type="color"
              value={activeColor}
              onChange={(event) => applyColor(event.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label="Custom colour"
            />
          </label>
        </div>

        <div className="mx-1 h-6 w-px bg-line" />

        <div className="flex min-w-[168px] items-center gap-2 px-1">
          <input
            type="range"
            min={widthRange(tool).min}
            max={widthRange(tool).max}
            step={widthRange(tool).step}
            value={tool === 'text' ? Math.max(1, settings.text.fontSize - 14) : activeWidth}
            onChange={(event) => applyWidth(Number(event.target.value))}
            className="h-1 w-24 accent-[#4a6156]"
            aria-label="Thickness"
          />
          <span className="w-8 text-[11px] tabular-nums text-ink-muted">
            {tool === 'text' ? settings.text.fontSize : Math.round(activeWidth)}
          </span>
        </div>

        {tool === 'eraser' && (
          <button
            type="button"
            onClick={() => update('eraser', { mode: settings.eraser.mode === 'stroke' ? 'partial' : 'stroke' })}
            className="rounded-md border border-line px-2 py-1 text-[11.5px] text-ink-soft"
          >
            {settings.eraser.mode === 'stroke' ? 'Whole stroke' : 'Partial'}
          </button>
        )}

        <div className="ml-auto flex items-center gap-0.5">
          {state.selectionCount > 0 && (
            <>
              <IconButton label="Copy selection" className="h-8 w-8" onClick={actions.copySelection}>
                <Copy size={16} strokeWidth={1.8} />
              </IconButton>
              <IconButton label="Delete selection" className="h-8 w-8" onClick={actions.deleteSelection}>
                <Trash2 size={16} strokeWidth={1.8} />
              </IconButton>
            </>
          )}
          {state.hasClipboard && (
            <IconButton label="Paste" className="h-8 w-8" onClick={actions.paste}>
              <ClipboardPaste size={16} strokeWidth={1.8} />
            </IconButton>
          )}
          <button
            type="button"
            onClick={actions.openSettings}
            className="rounded-md px-2 py-1 text-[11.5px] text-ink-muted hover:bg-paper-sunken"
          >
            Settings
          </button>
          <button
            type="button"
            onClick={actions.toggleCollapse}
            className="rounded-md px-2 py-1 text-[11.5px] text-ink-muted hover:bg-paper-sunken"
          >
            Hide
          </button>
        </div>
      </div>
    </div>
  );
}
