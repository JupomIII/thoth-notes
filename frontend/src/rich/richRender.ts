/**
 * Canvas painters for the rich page objects. Shared by the live editor overlay
 * (which uses DOM for text sharpness), thumbnails, PNG export and PDF export so
 * all four agree on geometry.
 */

import type { EquationPlacement, TableObject } from '../storage/types';
import { typesetMath } from './mathTypeset';

const UI_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

export function equationLabelHeight(eq: Pick<EquationPlacement, 'label' | 'fontSize'>): number {
  return eq.label.trim() ? Math.round(eq.fontSize * 0.78) + 6 : 0;
}

export function equationBoxHeight(eq: EquationPlacement): number {
  const layout = typesetMath(eq.latex, eq.fontSize, eq.color);
  return equationLabelHeight(eq) + layout.height + layout.depth + 6;
}

export function drawEquationObject(ctx: CanvasRenderingContext2D, eq: EquationPlacement): void {
  const layout = typesetMath(eq.latex, eq.fontSize, eq.color);
  const labelHeight = equationLabelHeight(eq);
  let x = eq.x;
  if (eq.align === 'center') x = eq.x + (eq.width - layout.width) / 2;
  else if (eq.align === 'right') x = eq.x + eq.width - layout.width;

  ctx.save();
  if (eq.label.trim()) {
    ctx.fillStyle = eq.color;
    ctx.globalAlpha = 0.62;
    ctx.font = `${Math.round(eq.fontSize * 0.62)}px ${UI_FONT}`;
    ctx.textBaseline = 'top';
    const labelX =
      eq.align === 'center'
        ? eq.x + eq.width / 2 - ctx.measureText(eq.label).width / 2
        : eq.align === 'right'
          ? eq.x + eq.width - ctx.measureText(eq.label).width
          : eq.x;
    ctx.fillText(eq.label, labelX, eq.y);
    ctx.globalAlpha = 1;
  }
  layout.draw(ctx, x, eq.y + labelHeight + layout.height);
  ctx.restore();
}

const CELL_PADDING = 9;

export function tableSize(table: TableObject): { width: number; height: number } {
  return {
    width: table.colWidths.reduce((sum, width) => sum + width, 0),
    height: table.rowHeights.reduce((sum, height) => sum + height, 0),
  };
}

export function drawTableObject(ctx: CanvasRenderingContext2D, table: TableObject): void {
  const { width, height } = tableSize(table);
  ctx.save();
  ctx.fillStyle = '#fffdfa';
  ctx.fillRect(table.x, table.y, width, height);

  let y = table.y;
  for (let row = 0; row < table.cells.length; row++) {
    const rowHeight = table.rowHeights[row] ?? 0;
    if (table.headerRow && row === 0) {
      ctx.fillStyle = 'rgba(31, 29, 26, 0.045)';
      ctx.fillRect(table.x, y, width, rowHeight);
    }
    let x = table.x;
    for (let col = 0; col < table.cells[row]!.length; col++) {
      const colWidth = table.colWidths[col] ?? 0;
      const value = table.cells[row]![col] ?? '';
      if (value) {
        ctx.fillStyle = table.color;
        ctx.font = `${row === 0 && table.headerRow ? '600 ' : ''}${table.fontSize}px ${UI_FONT}`;
        ctx.textBaseline = 'middle';
        const padding = CELL_PADDING;
        const available = colWidth - padding * 2;
        let text = value;
        if (ctx.measureText(text).width > available) {
          while (text.length > 1 && ctx.measureText(`${text}…`).width > available) text = text.slice(0, -1);
          text = `${text}…`;
        }
        const textWidth = ctx.measureText(text).width;
        const textX =
          table.align === 'center'
            ? x + (colWidth - textWidth) / 2
            : table.align === 'right'
              ? x + colWidth - padding - textWidth
              : x + padding;
        ctx.fillText(text, textX, y + rowHeight / 2 + 1);
      }
      x += colWidth;
    }
    y += rowHeight;
  }

  ctx.strokeStyle = table.borderColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  let lineY = table.y;
  for (let row = 0; row <= table.rowHeights.length; row++) {
    const py = Math.round(lineY) + 0.5;
    ctx.moveTo(table.x, py);
    ctx.lineTo(table.x + width, py);
    if (row < table.rowHeights.length) lineY += table.rowHeights[row]!;
  }
  let lineX = table.x;
  for (let col = 0; col <= table.colWidths.length; col++) {
    const px = Math.round(lineX) + 0.5;
    ctx.moveTo(px, table.y);
    ctx.lineTo(px, table.y + height);
    if (col < table.colWidths.length) lineX += table.colWidths[col]!;
  }
  ctx.stroke();
  ctx.restore();
}
