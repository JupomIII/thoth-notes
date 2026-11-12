/**
 * Shared record types. Every synchronised object carries the same envelope
 * fields so the Windows server and the iPad can merge them deterministically.
 */

export interface Envelope {
  id: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  deviceId: string;
  deletedAt: number | null;
}

export interface Folder extends Envelope {
  name: string;
  parentId: string | null;
  color: string;
}

export interface Notebook extends Envelope {
  title: string;
  folderId: string | null;
  coverColor: string;
  favorite: boolean;
  archived: boolean;
  sortIndex: number;
  lastOpenedAt: number | null;
}

export type PaperTemplate = 'blank' | 'ruled' | 'grid' | 'dots' | 'graph' | 'isometric';
export type PageSize = 'a4' | 'letter' | 'infinite';

export interface Page extends Envelope {
  notebookId: string;
  index: number;
  title: string;
  template: PaperTemplate;
  size: PageSize;
  /** Document-space size in CSS pixels at 150 DPI. 0 for infinite pages. */
  width: number;
  height: number;
  /** Asset id of the source PDF when this page annotates a PDF. */
  pdfAssetId: string | null;
  pdfPageIndex: number;
  backgroundTint: string | null;
}

export type DrawToolId =
  | 'fountain'
  | 'ballpoint'
  | 'pencil'
  | 'highlighter'
  | 'eraser'
  | 'lasso'
  | 'text'
  | 'image'
  | 'line'
  | 'rect'
  | 'circle'
  | 'arrow';

export type ShapeKind = 'line' | 'rect' | 'circle' | 'arrow';

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  timestamp: number;
}

export interface Stroke extends Envelope {
  pageId: string;
  tool: DrawToolId;
  color: string;
  width: number;
  opacity: number;
  points: StrokePoint[];
  /** Present when the stroke was produced by one of the shape tools. */
  shape: ShapeKind | null;
}

export interface TextBlock extends Envelope {
  pageId: string;
  x: number;
  y: number;
  width: number;
  text: string;
  fontSize: number;
  color: string;
  align: 'left' | 'center' | 'right';
}

export interface ImagePlacement extends Envelope {
  pageId: string;
  assetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Asset extends Envelope {
  kind: 'image' | 'pdf';
  mime: string;
  name: string;
  byteSize: number;
  sha256: string;
  pageCount: number;
}

export interface StoredAsset extends Asset {
  /** Raw bytes, kept locally and mirrored to the Windows server. Never in JSON payloads. */
  blob: Blob;
}

export interface SyncRecord<T = unknown> {
  kind: SyncKind;
  id: string;
  data: T;
  createdAt: number;
  updatedAt: number;
  version: number;
  deviceId: string;
  deletedAt: number | null;
}

export type SyncKind =
  | 'folder'
  | 'notebook'
  | 'page'
  | 'stroke'
  | 'text'
  | 'image'
  | 'asset';

export const SYNC_KINDS: SyncKind[] = [
  'folder',
  'notebook',
  'page',
  'stroke',
  'text',
  'image',
  'asset',
];

export const PAGE_SIZES: Record<PageSize, { width: number; height: number; label: string }> = {
  a4: { width: 1240, height: 1754, label: 'A4' },
  letter: { width: 1275, height: 1650, label: 'US Letter' },
  infinite: { width: 0, height: 0, label: 'Infinite' },
};

export interface BrushSettings {
  color: string;
  width: number;
  opacity: number;
}

export interface ToolSettings {
  fountain: BrushSettings;
  ballpoint: BrushSettings;
  pencil: BrushSettings;
  highlighter: BrushSettings;
  eraser: { width: number; mode: 'stroke' | 'partial' };
  lasso: { width: number; color: string; opacity: number };
  text: { fontSize: number; color: string };
  line: BrushSettings;
  rect: BrushSettings;
  circle: BrushSettings;
  arrow: BrushSettings;
  shapeFilled: boolean;
}

export const DEFAULT_TOOL_SETTINGS: ToolSettings = {
  fountain: { color: '#1f1d1a', width: 4, opacity: 1 },
  ballpoint: { color: '#23324a', width: 2.6, opacity: 1 },
  pencil: { color: '#3a3733', width: 3.2, opacity: 0.9 },
  highlighter: { color: '#f2d98a', width: 22, opacity: 0.35 },
  eraser: { width: 18, mode: 'stroke' },
  lasso: { width: 2, color: '#4a6156', opacity: 1 },
  text: { fontSize: 22, color: '#1f1d1a' },
  line: { color: '#1f1d1a', width: 3, opacity: 1 },
  rect: { color: '#1f1d1a', width: 3, opacity: 1 },
  circle: { color: '#1f1d1a', width: 3, opacity: 1 },
  arrow: { color: '#1f1d1a', width: 3, opacity: 1 },
  shapeFilled: false,
};

export interface AppSettings {
  toolbarPosition: { x: number; y: number } | null;
  toolbarCollapsed: boolean;
  oneFingerPan: boolean;
  palmRejection: boolean;
  showPageBoundary: boolean;
  serverUrl: string;
  autoSync: boolean;
  eraserMode: 'stroke' | 'partial';
}
