import type { EquationPlacement, GraphObject, TableObject } from '../storage/types';
import type { RichKind } from '../storage/repo';

export type ClipboardPayload =
  | { kind: 'equation'; data: EquationPlacement }
  | { kind: 'graph'; data: GraphObject }
  | { kind: 'table'; data: TableObject };

/**
 * Clipboard for rich objects. Kept in memory rather than the system clipboard
 * because these are structured documents, and it is shared by the toolbar, the
 * keyboard shortcuts and the paste action.
 */
let payload: ClipboardPayload | null = null;

export function setRichClipboard(next: ClipboardPayload | null): void {
  payload = next;
}

export function getRichClipboard(): ClipboardPayload | null {
  return payload;
}

export function clearRichClipboard(): void {
  payload = null;
}

export function kindLabel(kind: RichKind): string {
  if (kind === 'equation') return 'Equation';
  if (kind === 'graph') return 'Graph';
  return 'Table';
}
