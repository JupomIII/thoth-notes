import { useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import type { Envelope, TableObject } from '../storage/types';
import { Button, Segmented, Toggle, cx } from '../components/ui';

export type TableDraft = Omit<TableObject, keyof Envelope | 'pageId'>;

const COL_WIDTH = 150;
const ROW_HEIGHT = 42;

function blankTable(rows = 3, cols = 3): TableDraft {
  return {
    x: 0,
    y: 0,
    width: colSum(Array.from({ length: cols }, () => COL_WIDTH)),
    colWidths: Array.from({ length: cols }, () => COL_WIDTH),
    rowHeights: Array.from({ length: rows }, () => ROW_HEIGHT),
    cells: Array.from({ length: rows }, () => Array.from({ length: cols }, () => '')),
    headerRow: true,
    fontSize: 18,
    color: '#1f1d1a',
    borderColor: 'rgba(31, 29, 26, 0.28)',
    align: 'left',
  };
}

function colSum(widths: number[]): number {
  return widths.reduce((sum, value) => sum + value, 0);
}

export function TablePanel({
  initial,
  onCommit,
  onClose,
}: {
  initial?: TableObject | null;
  onCommit: (draft: TableDraft) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<TableDraft>(() => {
    if (!initial) return blankTable();
    return {
      x: initial.x,
      y: initial.y,
      width: initial.width,
      colWidths: [...initial.colWidths],
      rowHeights: [...initial.rowHeights],
      cells: initial.cells.map((row) => [...row]),
      headerRow: initial.headerRow,
      fontSize: initial.fontSize,
      color: initial.color,
      borderColor: initial.borderColor,
      align: initial.align,
    };
  });

  function setCell(row: number, col: number, value: string): void {
    setDraft((current) => ({
      ...current,
      cells: current.cells.map((cells, r) => (r === row ? cells.map((cell, c) => (c === col ? value : cell)) : cells)),
    }));
  }

  function addRow(): void {
    setDraft((current) => ({
      ...current,
      cells: [...current.cells, Array.from({ length: current.colWidths.length }, () => '')],
      rowHeights: [...current.rowHeights, ROW_HEIGHT],
    }));
  }

  function removeRow(): void {
    setDraft((current) =>
      current.cells.length <= 1
        ? current
        : {
            ...current,
            cells: current.cells.slice(0, -1),
            rowHeights: current.rowHeights.slice(0, -1),
          },
    );
  }

  function addColumn(): void {
    setDraft((current) => {
      const colWidths = [...current.colWidths, COL_WIDTH];
      return {
        ...current,
        colWidths,
        width: colSum(colWidths),
        cells: current.cells.map((row) => [...row, '']),
      };
    });
  }

  function removeColumn(): void {
    setDraft((current) => {
      if (current.colWidths.length <= 1) return current;
      const colWidths = current.colWidths.slice(0, -1);
      return {
        ...current,
        colWidths,
        width: colSum(colWidths),
        cells: current.cells.map((row) => row.slice(0, -1)),
      };
    });
  }

  return (
    <div className="animate-in absolute inset-x-0 bottom-0 z-40 flex max-h-[78dvh] flex-col overflow-hidden rounded-t-2xl border border-line bg-paper-raised shadow-float sm:inset-x-3 sm:bottom-3 sm:rounded-2xl lg:inset-x-auto lg:right-4 lg:top-16 lg:w-[680px]">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <h2 className="font-serif text-[17px] text-ink">Table</h2>
          <span className="text-[11.5px] text-ink-muted">
            {draft.cells.length} × {draft.colWidths.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" className="h-9 px-2 text-[13px]" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" className="h-9 px-3 text-[13px]" onClick={() => onCommit(draft)}>
            {initial ? 'Update' : 'Insert'}
          </Button>
          <button
            type="button"
            aria-label="Close table editor"
            onClick={onClose}
            className="ml-1 flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-paper-sunken"
          >
            <X size={17} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <div className="thin-scroll flex-1 space-y-3 overflow-y-auto p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="secondary" className="h-8 px-2 text-[12px]" onClick={addRow}>
            <Plus size={13} strokeWidth={2} /> Row
          </Button>
          <Button variant="secondary" className="h-8 px-2 text-[12px]" onClick={removeRow} disabled={draft.cells.length <= 1}>
            <Minus size={13} strokeWidth={2} /> Row
          </Button>
          <Button variant="secondary" className="h-8 px-2 text-[12px]" onClick={addColumn}>
            <Plus size={13} strokeWidth={2} /> Column
          </Button>
          <Button variant="secondary" className="h-8 px-2 text-[12px]" onClick={removeColumn} disabled={draft.colWidths.length <= 1}>
            <Minus size={13} strokeWidth={2} /> Column
          </Button>
          <Segmented
            options={[
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Centre' },
              { value: 'right', label: 'Right' },
            ]}
            value={draft.align}
            onChange={(value) => setDraft((current) => ({ ...current, align: value }))}
          />
        </div>

        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse" style={{ minWidth: colSum(draft.colWidths) }}>
            <colgroup>
              {draft.colWidths.map((width, index) => (
                <col key={index} style={{ width }} />
              ))}
            </colgroup>
            <tbody>
              {draft.cells.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, colIndex) => (
                    <td
                      key={colIndex}
                      className={cx('border border-line p-0', draft.headerRow && rowIndex === 0 && 'bg-paper-sunken/60')}
                    >
                      <input
                        value={cell}
                        onChange={(event) => setCell(rowIndex, colIndex, event.target.value)}
                        className={cx(
                          'h-10 w-full bg-transparent px-2 text-[13.5px] text-ink outline-none focus:bg-accent-soft/40',
                          draft.headerRow && rowIndex === 0 && 'font-semibold',
                          draft.align === 'center' && 'text-center',
                          draft.align === 'right' && 'text-right',
                        )}
                        aria-label={`Row ${rowIndex + 1} column ${colIndex + 1}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-line rounded-lg border border-line px-3 py-2">
          <Toggle
            checked={draft.headerRow}
            onChange={(value) => setDraft((current) => ({ ...current, headerRow: value }))}
            label="Header row"
            description="Shown in semibold with a tinted background."
          />
          <div className="flex items-center gap-2 py-2">
            <span className="text-[13px] text-ink">Text size</span>
            <Segmented
              options={[
                { value: '16', label: 'S' },
                { value: '18', label: 'M' },
                { value: '22', label: 'L' },
              ]}
              value={String(draft.fontSize)}
              onChange={(value) => setDraft((current) => ({ ...current, fontSize: Number(value) }))}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
