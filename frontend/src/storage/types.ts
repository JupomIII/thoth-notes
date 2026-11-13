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

export type PaperTemplate =
  | 'blank'
  | 'ruled'
  | 'grid'
  | 'dots'
  | 'graph'
  | 'isometric'
  | 'engineering';
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
  /** Base spacing for grid-like paper, in document pixels. */
  gridSpacing?: number;
}

export type DrawToolId =
  | 'fountain'
  | 'ballpoint'
  | 'pencil'
  | 'highlighter'
  | 'eraser'
  | 'lasso'
  | 'text'
  | 'select'
  | 'image'
  | 'line'
  | 'rect'
  | 'circle'
  | 'ellipse'
  | 'triangle'
  | 'arrow';

export type ShapeKind = 'line' | 'rect' | 'circle' | 'ellipse' | 'triangle' | 'arrow';

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

/** A LaTeX equation placed on a page. The source is always kept, never an image. */
export interface EquationPlacement extends Envelope {
  pageId: string;
  latex: string;
  x: number;
  y: number;
  /** Document-space box width; the height follows the rendered formula. */
  width: number;
  fontSize: number;
  color: string;
  align: 'left' | 'center' | 'right';
  /** Optional caption drawn above the formula. */
  label: string;
}

export interface GraphFunction {
  id: string;
  /** Expression in mathjs syntax; converted from the LaTeX-ish input. */
  expression: string;
  color: string;
  width: number;
  dashed: boolean;
  visible: boolean;
}

export interface GraphPoint {
  id: string;
  x: number;
  y: number;
  label: string;
  color: string;
}

/** A live coordinate system on a page; the function list stays editable. */
export interface GraphObject extends Envelope {
  pageId: string;
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
}

export interface TableObject extends Envelope {
  pageId: string;
  x: number;
  y: number;
  width: number;
  colWidths: number[];
  rowHeights: number[];
  cells: string[][];
  headerRow: boolean;
  fontSize: number;
  color: string;
  borderColor: string;
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
  | 'equation'
  | 'graph'
  | 'table'
  | 'asset';

export const SYNC_KINDS: SyncKind[] = [
  'folder',
  'notebook',
  'page',
  'stroke',
  'text',
  'image',
  'equation',
  'graph',
  'table',
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
  ellipse: BrushSettings;
  triangle: BrushSettings;
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
  ellipse: { color: '#1f1d1a', width: 3, opacity: 1 },
  triangle: { color: '#1f1d1a', width: 3, opacity: 1 },
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
  /** Chrome colour scheme. 'system' follows iPadOS. */
  theme: 'light' | 'dark' | 'system';
  /** Recently used ink colours, newest first. */
  recentColors: string[];
  /** Base grid spacing in document pixels for grid-like paper. */
  gridSpacing: number;
  /** Snaps geometry tools to the grid and to 15-degree steps. */
  snapEnabled: boolean;
  /** Offers to replace a wobbly freehand shape with a clean one. */
  recognizeShapes: boolean;
  /** Last used drawing tool, restored on the next page. */
  lastTool: string;
}
