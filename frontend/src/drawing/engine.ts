import type {
  DrawToolId,
  ImagePlacement,
  Page,
  Stroke,
  StrokePoint,
  TextBlock,
  ToolSettings,
} from '../storage/types';
import { newId, now } from '../lib/id';
import {
  boundsIntersect,
  boundsOfPoints,
  pointInPolygon,
  polylineDistance,
  simplifyPoints,
  type Bounds,
} from '../lib/geometry';
import { drawPaper } from './paper';
import { drawStroke } from './strokeRender';
import { paintText } from './textRender';
import { HistoryStack } from './history';

export interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

export interface PageContent {
  strokes: Stroke[];
  texts: TextBlock[];
  images: ImagePlacement[];
}

export interface PagePersistence {
  addStrokes(strokes: Stroke[]): void;
  updateStrokes(strokes: Stroke[]): void;
  deleteStrokes(ids: string[]): void;
  addTexts(texts: TextBlock[]): void;
  updateTexts(texts: TextBlock[]): void;
  deleteTexts(ids: string[]): void;
  addImages(images: ImagePlacement[]): void;
  updateImages(images: ImagePlacement[]): void;
  deleteImages(ids: string[]): void;
  notifyChange(): void;
}

export interface SelectionSummary {
  count: number;
  bounds: Bounds | null;
}

export interface TextDraft {
  id: string | null;
  x: number;
  y: number;
  width: number;
  text: string;
  fontSize: number;
  color: string;
  align: 'left' | 'center' | 'right';
}

export interface EngineCallbacks {
  onSelectionChange(selection: SelectionSummary): void;
  onHistoryChange(): void;
  onViewChange(view: ViewTransform): void;
  requestTextEdit(draft: TextDraft): void;
  requestImage(): void;
}

interface Mutation {
  label: string;
  addedStrokes?: Stroke[];
  removedStrokes?: Stroke[];
  updatedStrokes?: { before: Stroke; after: Stroke }[];
  addedTexts?: TextBlock[];
  removedTexts?: TextBlock[];
  updatedTexts?: { before: TextBlock; after: TextBlock }[];
  addedImages?: ImagePlacement[];
  removedImages?: ImagePlacement[];
  updatedImages?: { before: ImagePlacement; after: ImagePlacement }[];
}

interface Selection {
  strokeIds: Set<string>;
  textIds: Set<string>;
  imageIds: Set<string>;
}

type Session =
  | { kind: 'none' }
  | { kind: 'draw'; stroke: Stroke }
  | { kind: 'shape'; start: StrokePoint; current: StrokePoint }
  | {
      kind: 'erase';
      last: StrokePoint;
      before: Stroke[];
      lastEraseAt: number;
    }
  | { kind: 'lasso'; points: StrokePoint[] }
  | {
      kind: 'move';
      start: { x: number; y: number };
      last: { x: number; y: number };
      strokes: Stroke[];
      texts: TextBlock[];
      images: ImagePlacement[];
    }
  | {
      kind: 'resize';
      origin: { x: number; y: number };
      last: { x: number; y: number };
      strokes: Stroke[];
      texts: TextBlock[];
      images: ImagePlacement[];
    }
  | { kind: 'pan'; last: { x: number; y: number } }
  | {
      kind: 'pinch';
      startDist: number;
      startScale: number;
      startMid: { x: number; y: number };
      startView: ViewTransform;
    };

const HANDLE_SCREEN_SIZE = 18;
const MIN_STROKE_DISTANCE = 0.35;
const ERASE_THROTTLE_MS = 34;

export class DrawingEngine {
  private readonly stage: HTMLElement;
  private readonly paperCanvas: HTMLCanvasElement;
  private readonly inkCanvas: HTMLCanvasElement;
  private readonly liveCanvas: HTMLCanvasElement;
  private readonly paperCtx: CanvasRenderingContext2D;
  private readonly inkCtx: CanvasRenderingContext2D;
  private readonly liveCtx: CanvasRenderingContext2D;

  private dpr = 1;
  private cssWidth = 0;
  private cssHeight = 0;

  page: Page | null = null;
  view: ViewTransform = { scale: 1, tx: 0, ty: 0 };
  tool: DrawToolId = 'fountain';
  toolSettings: ToolSettings;
  oneFingerPan = true;
  palmRejection = true;
  showBoundary = true;

  private strokes: Stroke[] = [];
  private texts: TextBlock[] = [];
  private images: ImagePlacement[] = [];
  private strokeById = new Map<string, Stroke>();
  private strokeBounds = new Map<string, Bounds>();
  private imageBitmaps = new Map<string, CanvasImageSource>();
  private pdfBitmap: { image: CanvasImageSource; width: number; height: number } | null = null;

  private selection: Selection = {
    strokeIds: new Set(),
    textIds: new Set(),
    imageIds: new Set(),
  };

  private session: Session = { kind: 'none' };
  private activePointers = new Map<number, { x: number; y: number; type: string }>();
  private penDown = false;
  private penLastAt = 0;

  private pendingPaper = true;
  private pendingInk = true;
  private pendingLive = true;
  private rafId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private viewSettleTimer: number | null = null;
  private disposed = false;

  private clipboard: PageContent | null = null;

  readonly history = new HistoryStack();

  constructor(
    stage: HTMLElement,
    private readonly persistence: PagePersistence,
    private readonly callbacks: EngineCallbacks,
    toolSettings: ToolSettings,
  ) {
    this.stage = stage;
    this.toolSettings = toolSettings;

    const makeLayer = (zIndex: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
      const canvas = document.createElement('canvas');
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.zIndex = String(zIndex);
      canvas.style.touchAction = 'none';
      stage.appendChild(canvas);
      const ctx = canvas.getContext('2d', { alpha: zIndex !== 0, desynchronized: true });
      if (!ctx) throw new Error('Canvas 2D is not available in this browser');
      return [canvas, ctx];
    };

    [this.paperCanvas, this.paperCtx] = makeLayer(0);
    [this.inkCanvas, this.inkCtx] = makeLayer(1);
    [this.liveCanvas, this.liveCtx] = makeLayer(2);

    this.stage.style.position = 'relative';
    this.stage.style.touchAction = 'none';
    this.stage.style.overflow = 'hidden';

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(stage);
    this.resize();

    stage.addEventListener('pointerdown', this.onPointerDown);
    stage.addEventListener('pointermove', this.onPointerMove);
    stage.addEventListener('pointerup', this.onPointerUp);
    stage.addEventListener('pointercancel', this.onPointerCancel);
    stage.addEventListener('wheel', this.onWheel, { passive: false });
    stage.addEventListener('contextmenu', this.onContextMenu);

    this.history.subscribe(() => this.callbacks.onHistoryChange());
  }

  dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this.viewSettleTimer !== null) window.clearTimeout(this.viewSettleTimer);
    this.resizeObserver?.disconnect();
    this.stage.removeEventListener('pointerdown', this.onPointerDown);
    this.stage.removeEventListener('pointermove', this.onPointerMove);
    this.stage.removeEventListener('pointerup', this.onPointerUp);
    this.stage.removeEventListener('pointercancel', this.onPointerCancel);
    this.stage.removeEventListener('wheel', this.onWheel);
    this.stage.removeEventListener('contextmenu', this.onContextMenu);
    this.paperCanvas.remove();
    this.inkCanvas.remove();
    this.liveCanvas.remove();
  }

  /* ---------------------------------------------------------------- */
  /* Page lifecycle                                                    */
  /* ---------------------------------------------------------------- */

  setPage(page: Page, content: PageContent): void {
    this.page = page;
    this.pdfBitmap = null;
    this.strokes = [...content.strokes];
    this.texts = [...content.texts];
    this.images = [...content.images];
    this.rebuildIndex();
    this.selection = { strokeIds: new Set(), textIds: new Set(), imageIds: new Set() };
    this.session = { kind: 'none' };
    this.history.clear();
    this.callbacks.onSelectionChange({ count: 0, bounds: null });
    this.fitToPage();
    this.invalidateAll();
  }

  setPdfBitmap(image: CanvasImageSource | null, width = 0, height = 0): void {
    this.pdfBitmap = image ? { image, width, height } : null;
    this.pendingPaper = true;
    this.schedule();
  }

  setImageBitmap(assetId: string, image: CanvasImageSource): void {
    this.imageBitmaps.set(assetId, image);
    this.pendingInk = true;
    this.schedule();
  }

  restoreDraft(stroke: Stroke): void {
    if (this.strokeById.has(stroke.id)) return;
    this.applyMutation({ label: 'Recovered draft', addedStrokes: [stroke] }, { record: false });
  }

  getActiveStroke(): Stroke | null {
    return this.session.kind === 'draw' ? this.session.stroke : null;
  }

  snapshot(): PageContent {
    return {
      strokes: this.strokes.slice(),
      texts: this.texts.slice(),
      images: this.images.slice(),
    };
  }

  /* ---------------------------------------------------------------- */
  /* View control                                                      */
  /* ---------------------------------------------------------------- */

  resize(): void {
    const rect = this.stage.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    const changed = width !== this.cssWidth || height !== this.cssHeight;
    this.cssWidth = width;
    this.cssHeight = height;
    if (!changed) return;
    for (const canvas of [this.paperCanvas, this.inkCanvas, this.liveCanvas]) {
      canvas.width = Math.round(width * this.dpr);
      canvas.height = Math.round(height * this.dpr);
    }
    this.invalidateAll();
  }

  get viewportSize(): { width: number; height: number } {
    return { width: this.cssWidth, height: this.cssHeight };
  }

  private pageSize(): { width: number; height: number } {
    if (!this.page) return { width: this.cssWidth, height: this.cssHeight };
    if (this.page.size === 'infinite') return { width: this.cssWidth, height: this.cssHeight };
    return { width: this.page.width, height: this.page.height };
  }

  fitToPage(): void {
    if (!this.page) return;
    if (this.page.size === 'infinite') {
      this.view = { scale: 1, tx: this.cssWidth / 2, ty: this.cssHeight / 2 };
    } else {
      const pad = 24;
      const raw = Math.min(
        (this.cssWidth - pad * 2) / this.page.width,
        (this.cssHeight - pad * 2) / this.page.height,
      );
      const s = Math.max(0.15, Math.min(4, raw));
      this.view = {
        scale: s,
        tx: (this.cssWidth - this.page.width * s) / 2,
        ty: (this.cssHeight - this.page.height * s) / 2,
      };
    }
    this.callbacks.onViewChange({ ...this.view });
    this.pendingPaper = true;
    this.pendingInk = true;
    this.schedule();
    this.emitViewSettled();
  }

  zoomBy(factor: number, center?: { x: number; y: number }): void {
    const cx = center?.x ?? this.cssWidth / 2;
    const cy = center?.y ?? this.cssHeight / 2;
    const scale = Math.max(0.15, Math.min(8, this.view.scale * factor));
    const applied = scale / this.view.scale;
    this.view = {
      scale,
      tx: cx - (cx - this.view.tx) * applied,
      ty: cy - (cy - this.view.ty) * applied,
    };
    this.callbacks.onViewChange({ ...this.view });
    this.pendingPaper = true;
    this.pendingInk = true;
    this.schedule();
    this.emitViewSettled();
  }

  setView(view: ViewTransform): void {
    this.view = view;
    this.callbacks.onViewChange({ ...this.view });
    this.invalidateAll();
  }

  private emitViewSettled(): void {
    if (this.viewSettleTimer !== null) window.clearTimeout(this.viewSettleTimer);
    this.viewSettleTimer = window.setTimeout(() => {
      this.viewSettleTimer = null;
      this.callbacks.onViewChange({ ...this.view });
    }, 180);
  }

  toDoc(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - this.view.tx) / this.view.scale,
      y: (screenY - this.view.ty) / this.view.scale,
    };
  }

  toScreen(docX: number, docY: number): { x: number; y: number } {
    return {
      x: docX * this.view.scale + this.view.tx,
      y: docY * this.view.scale + this.view.ty,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Rendering                                                         */
  /* ---------------------------------------------------------------- */

  private invalidateAll(): void {
    this.pendingPaper = true;
    this.pendingInk = true;
    this.pendingLive = true;
    this.schedule();
  }

  private invalidateLive(): void {
    this.pendingLive = true;
    this.schedule();
  }

  private invalidateInk(): void {
    this.pendingInk = true;
    this.pendingLive = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.disposed || this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.render();
    });
  }

  private applyView(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.translate(this.view.tx, this.view.ty);
    ctx.scale(this.view.scale, this.view.scale);
  }

  private viewportDocBounds(): Bounds {
    const tl = this.toDoc(0, 0);
    const br = this.toDoc(this.cssWidth, this.cssHeight);
    return { minX: tl.x, minY: tl.y, maxX: br.x, maxY: br.y };
  }

  private render(): void {
    if (this.disposed) return;
    if (this.pendingPaper) {
      this.pendingPaper = false;
      this.paintPaper();
    }
    if (this.pendingInk) {
      this.pendingInk = false;
      this.paintInk();
    }
    if (this.pendingLive) {
      this.pendingLive = false;
      this.paintLive();
    }
  }

  private paintPaper(): void {
    const ctx = this.paperCtx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    if (!this.page) return;
    this.applyView(ctx);
    drawPaper(ctx, {
      template: this.page.template,
      width: this.page.width,
      height: this.page.height,
      scale: this.view.scale,
      tint: this.page.backgroundTint,
      infinite: this.page.size === 'infinite',
      showBoundary: this.showBoundary,
    });
    const pdf = this.pdfBitmap;
    if (pdf && this.page.pdfAssetId) {
      const px = this.page.size === 'infinite' ? this.cssWidth / this.view.scale : this.page.width;
      const py = this.page.size === 'infinite' ? this.cssHeight / this.view.scale : this.page.height;
      const ratio = Math.min(px / (pdf.width || px), py / (pdf.height || py));
      const w = (pdf.width || px) * ratio;
      const h = (pdf.height || py) * ratio;
      ctx.drawImage(pdf.image, (px - w) / 2, (py - h) / 2, w, h);
    }
  }

  private paintInk(): void {
    const ctx = this.inkCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.inkCanvas.width, this.inkCanvas.height);
    this.applyView(ctx);

    const viewport = this.viewportDocBounds();
    for (const stroke of this.strokes) {
      if (!boundsIntersect(this.boundsFor(stroke), viewport)) continue;
      drawStroke(ctx, stroke);
    }
    for (const image of this.images) {
      const bitmap = this.imageBitmaps.get(image.assetId);
      if (!bitmap) {
        ctx.save();
        ctx.strokeStyle = 'rgba(31,29,26,0.25)';
        ctx.setLineDash([6 / this.view.scale, 6 / this.view.scale]);
        ctx.strokeRect(image.x, image.y, image.width, image.height);
        ctx.restore();
        continue;
      }
      ctx.drawImage(bitmap, image.x, image.y, image.width, image.height);
    }
    for (const text of this.texts) paintText(ctx, text);
  }


  private boundsFor(stroke: Stroke): Bounds {
    const cached = this.strokeBounds.get(stroke.id);
    if (cached) return cached;
    const bounds = boundsOfPoints(stroke.points, stroke.width * 1.5 + 2);
    this.strokeBounds.set(stroke.id, bounds);
    return bounds;
  }

  private paintLive(): void {
    const ctx = this.liveCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.liveCanvas.width, this.liveCanvas.height);
    this.applyView(ctx);
    const s = this.view.scale;

    switch (this.session.kind) {
      case 'draw':
        drawStroke(ctx, this.session.stroke);
        break;
      case 'shape':
        drawStroke(ctx, this.makeShapeStroke(this.session.start, this.session.current));
        break;
      case 'erase': {
        const p = this.session.last;
        ctx.save();
        ctx.strokeStyle = 'rgba(74,97,86,0.65)';
        ctx.lineWidth = 1 / s;
        ctx.beginPath();
        ctx.arc(p.x, p.y, this.toolSettings.eraser.width / 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'lasso': {
        const points = this.session.points;
        if (points.length > 1) {
          ctx.save();
          ctx.strokeStyle = this.toolSettings.lasso.color;
          ctx.lineWidth = 1.5 / s;
          ctx.setLineDash([6 / s, 5 / s]);
          ctx.beginPath();
          ctx.moveTo(points[0]!.x, points[0]!.y);
          for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
          ctx.closePath();
          ctx.stroke();
          ctx.restore();
        }
        break;
      }
      default:
        break;
    }

    const bounds = this.selectionBounds();
    if (bounds) {
      ctx.save();
      ctx.strokeStyle = '#4a6156';
      ctx.lineWidth = 1.5 / s;
      ctx.setLineDash([7 / s, 5 / s]);
      ctx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
      ctx.setLineDash([]);
      const handle = HANDLE_SCREEN_SIZE / s;
      const hx = bounds.maxX - handle / 2;
      const hy = bounds.maxY - handle / 2;
      ctx.fillStyle = '#fffdfa';
      ctx.fillRect(hx, hy, handle, handle);
      ctx.strokeRect(hx, hy, handle, handle);
      ctx.restore();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Input                                                             */
  /* ---------------------------------------------------------------- */

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private localPoint(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.stage.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private makePoint(e: PointerEvent): StrokePoint {
    const local = this.localPoint(e);
    const doc = this.toDoc(local.x, local.y);
    const pressure = e.pointerType === 'pen' ? Math.max(0.01, e.pressure || 0.4) : 0.5;
    return {
      x: doc.x,
      y: doc.y,
      pressure: Math.min(1, pressure),
      tiltX: e.tiltX ?? 0,
      tiltY: e.tiltY ?? 0,
      timestamp: e.timeStamp,
    };
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.page) return;
    const local = this.localPoint(e);
    this.activePointers.set(e.pointerId, { x: local.x, y: local.y, type: e.pointerType });
    try {
      this.stage.setPointerCapture(e.pointerId);
    } catch {
      /* Safari may refuse capture for pointers it has already cancelled. */
    }

    const touchCount = this.countTouches();

    if (e.pointerType === 'touch') {
      if (this.palmRejection) {
        if (this.penDown) return;
        if (e.timeStamp - this.penLastAt < 40) return;
        if (this.session.kind === 'draw' || this.session.kind === 'shape') return;
      }
      if (touchCount >= 2) {
        this.beginPinch();
        return;
      }
      if (this.oneFingerPan && touchCount === 1) {
        this.session = { kind: 'pan', last: local };
      }
      return;
    }

    if (e.pointerType === 'pen') this.penDown = true;
    if (this.session.kind === 'pan' || this.session.kind === 'pinch') {
      this.session = { kind: 'none' };
    }
    this.beginTool(e);
  };

  private countTouches(): number {
    let n = 0;
    for (const p of this.activePointers.values()) if (p.type === 'touch') n += 1;
    return n;
  }

  private beginTool(e: PointerEvent): void {
    const point = this.makePoint(e);

    switch (this.tool) {
      case 'fountain':
      case 'ballpoint':
      case 'pencil':
      case 'highlighter': {
        const settings = this.toolSettings[this.tool];
        const stroke: Stroke = {
          id: newId(),
          pageId: this.page!.id,
          tool: this.tool,
          color: settings.color,
          width: settings.width,
          opacity: settings.opacity,
          points: [point],
          shape: null,
          createdAt: now(),
          updatedAt: now(),
          version: 1,
          deviceId: '',
          deletedAt: null,
        };
        this.session = { kind: 'draw', stroke };
        this.invalidateLive();
        break;
      }
      case 'line':
      case 'rect':
      case 'circle':
      case 'arrow':
        this.session = { kind: 'shape', start: point, current: point };
        this.invalidateLive();
        break;
      case 'eraser':
        this.session = {
          kind: 'erase',
          last: point,
          before: this.strokes.slice(),
          lastEraseAt: performance.now(),
        };
        this.eraseAt(point, this.toolSettings.eraser.width / 2);
        break;
      case 'lasso': {
        const local = localFromStage(this.stage, e);
        if (this.hasSelection()) {
          if (this.hitResizeHandle(local)) {
            this.beginResize(point);
            return;
          }
          if (this.selectionContains(point)) {
            this.beginMove(point);
            return;
          }
        }
        this.clearSelection();
        this.session = { kind: 'lasso', points: [point] };
        this.invalidateLive();
        break;
      }
      case 'text': {
        this.clearSelection();
        const stageLocal = localFromStage(this.stage, e);
        const doc = this.toDoc(stageLocal.x, stageLocal.y);
        this.callbacks.requestTextEdit({
          id: null,
          x: doc.x,
          y: doc.y,
          width: 320,
          text: '',
          fontSize: this.toolSettings.text.fontSize,
          color: this.toolSettings.text.color,
          align: 'left',
        });
        break;
      }
      case 'image':
        this.callbacks.requestImage();
        break;
      default:
        break;
    }
  }

  private beginPinch(): void {
    const touches = [...this.activePointers.values()].filter((p) => p.type === 'touch');
    if (touches.length < 2) return;
    const a = touches[0]!;
    const b = touches[1]!;
    this.session = {
      kind: 'pinch',
      startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      startScale: this.view.scale,
      startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      startView: { ...this.view },
    };
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.page) return;
    const local = this.localPoint(e);
    const stored = this.activePointers.get(e.pointerId);
    if (stored) {
      stored.x = local.x;
      stored.y = local.y;
    }

    switch (this.session.kind) {
      case 'draw': {
        if (e.pointerType !== 'pen' && e.pointerType !== 'mouse') break;
        const stroke = this.session.stroke;
        const events =
          typeof e.getCoalescedEvents === 'function' ? (e.getCoalescedEvents() as PointerEvent[]) : [];
        const list = events.length > 0 ? events : [e];
        for (const ev of list) {
          const p = this.makePoint(ev);
          const last = stroke.points[stroke.points.length - 1]!;
          if (Math.hypot(p.x - last.x, p.y - last.y) < MIN_STROKE_DISTANCE) continue;
          stroke.points.push(p);
        }
        this.invalidateLive();
        break;
      }
      case 'shape': {
        this.session.current = this.makePoint(e);
        this.invalidateLive();
        break;
      }
      case 'erase': {
        if (e.pointerType === 'touch') break;
        const point = this.makePoint(e);
        const t = performance.now();
        if (t - this.session.lastEraseAt >= ERASE_THROTTLE_MS) {
          this.eraseSegment(this.session.last, point, this.toolSettings.eraser.width / 2);
          this.session.lastEraseAt = t;
          this.session.last = point;
        }
        this.invalidateLive();
        break;
      }
      case 'lasso': {
        const point = this.makePoint(e);
        const last = this.session.points[this.session.points.length - 1]!;
        if (Math.hypot(point.x - last.x, point.y - last.y) > 2 / this.view.scale) {
          this.session.points.push(point);
          this.invalidateLive();
        }
        break;
      }
      case 'move': {
        const point = this.makePoint(e);
        const dx = point.x - this.session.last.x;
        const dy = point.y - this.session.last.y;
        if (dx === 0 && dy === 0) break;
        this.session.last = { x: point.x, y: point.y };
        this.translateSelection(dx, dy);
        this.invalidateInk();
        break;
      }
      case 'resize': {
        const point = this.makePoint(e);
        this.session.last = { x: point.x, y: point.y };
        const origin = this.session.origin;
        const startDx = Math.abs(this.resizeStartX - origin.x);
        const startDy = Math.abs(this.resizeStartY - origin.y);
        const factorX = Math.abs(point.x - origin.x) / Math.max(4, startDx);
        const factorY = Math.abs(point.y - origin.y) / Math.max(4, startDy);
        const factor = (factorX + factorY) / 2;
        this.scaleSelection(origin, factor);
        this.invalidateInk();
        break;
      }
      case 'pan': {
        const dx = local.x - this.session.last.x;
        const dy = local.y - this.session.last.y;
        this.session.last = local;
        this.view = { ...this.view, tx: this.view.tx + dx, ty: this.view.ty + dy };
        this.pendingPaper = true;
        this.pendingInk = true;
        this.invalidateLive();
        this.callbacks.onViewChange({ ...this.view });
        break;
      }
      case 'pinch': {
        const touches = [...this.activePointers.values()].filter((p) => p.type === 'touch');
        if (touches.length < 2) break;
        const a = touches[0]!;
        const b = touches[1]!;
        const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const s = this.session;
        const scale = Math.max(0.15, Math.min(8, s.startScale * (dist / s.startDist)));
        const applied = scale / s.startScale;
        this.view = {
          scale,
          tx: mid.x - (s.startMid.x - s.startView.tx) * applied,
          ty: mid.y - (s.startMid.y - s.startView.ty) * applied,
        };
        this.pendingPaper = true;
        this.pendingInk = true;
        this.invalidateLive();
        this.callbacks.onViewChange({ ...this.view });
        break;
      }
      default:
        break;
    }
  };

  private resizeStartX = 0;
  private resizeStartY = 0;

  private onPointerUp = (e: PointerEvent): void => {
    this.finishSession(e, false);
    this.activePointers.delete(e.pointerId);
    if (e.pointerType === 'pen') {
      this.penDown = false;
      this.penLastAt = e.timeStamp;
    }
    if (this.session.kind === 'pinch') {
      const remaining = [...this.activePointers.values()].find((p) => p.type === 'touch');
      this.session = remaining ? { kind: 'pan', last: { x: remaining.x, y: remaining.y } } : { kind: 'none' };
      if (!remaining) this.emitViewSettled();
    }
    try {
      this.stage.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  private onPointerCancel = (e: PointerEvent): void => {
    this.finishSession(e, true);
    this.activePointers.delete(e.pointerId);
    if (e.pointerType === 'pen') {
      this.penDown = false;
      this.penLastAt = e.timeStamp;
    }
    this.session = { kind: 'none' };
    this.invalidateLive();
  };

  private finishSession(_e: PointerEvent, cancelled: boolean): void {
    const session = this.session;
    switch (session.kind) {
      case 'draw': {
        const stroke = session.stroke;
        this.session = { kind: 'none' };
        if (stroke.points.length >= 2) {
          this.commitStrokes(
            [{ ...stroke, points: simplifyPoints(stroke.points, 0.25), updatedAt: now() }],
            'Draw',
          );
        } else if (stroke.points.length === 1 && !cancelled) {
          this.commitStrokes([stroke], 'Dot');
        }
        this.invalidateLive();
        break;
      }
      case 'shape': {
        const { start, current } = session;
        this.session = { kind: 'none' };
        if (Math.hypot(current.x - start.x, current.y - start.y) > 2) {
          const settings =
            this.toolSettings[this.tool as 'line' | 'rect' | 'circle' | 'arrow'] ?? this.toolSettings.line;
          this.commitStrokes(
            [
              {
                id: newId(),
                pageId: this.page!.id,
                tool: this.tool,
                color: settings.color,
                width: settings.width,
                opacity: settings.opacity,
                points: [start, current],
                shape: this.tool as 'line' | 'rect' | 'circle' | 'arrow',
                createdAt: now(),
                updatedAt: now(),
                version: 1,
                deviceId: '',
                deletedAt: null,
              },
            ],
            'Shape',
          );
        }
        this.invalidateLive();
        break;
      }
      case 'erase': {
        this.session = { kind: 'none' };
        this.commitErase(session.before);
        break;
      }
      case 'lasso': {
        const polygon = session.points;
        this.session = { kind: 'none' };
        if (polygon.length > 2) this.selectInsidePolygon(polygon);
        this.invalidateLive();
        break;
      }
      case 'move':
      case 'resize': {
        this.session = { kind: 'none' };
        this.commitTransform(session, session.kind === 'move' ? 'Move selection' : 'Resize selection');
        break;
      }
      case 'pinch':
        this.emitViewSettled();
        break;
      default:
        break;
    }
    if (cancelled) this.invalidateLive();
  }

  private onWheel = (e: WheelEvent): void => {
    if (!this.page) return;
    e.preventDefault();
    const local = this.localPoint(e);
    if (e.ctrlKey || e.metaKey) {
      this.zoomBy(Math.exp(-e.deltaY * 0.01), local);
      return;
    }
    this.view = { ...this.view, tx: this.view.tx - e.deltaX, ty: this.view.ty - e.deltaY };
    this.pendingPaper = true;
    this.pendingInk = true;
    this.schedule();
    this.emitViewSettled();
  };

  /* ---------------------------------------------------------------- */
  /* Mutations                                                         */
  /* ---------------------------------------------------------------- */

  private rebuildIndex(): void {
    this.strokeById.clear();
    this.strokeBounds.clear();
    for (const stroke of this.strokes) this.strokeById.set(stroke.id, stroke);
  }

  /**
   * Applies a model mutation and mirrors it to storage. Mutations are
   * idempotent so undo/redo can replay them safely.
   */
  private applyMutation(mutation: Mutation, opts: { record?: boolean } = {}): void {
    const record = opts.record !== false;

    if (mutation.removedStrokes?.length) {
      const ids = new Set(mutation.removedStrokes.map((s) => s.id));
      const existing = this.strokes.filter((s) => ids.has(s.id)).map((s) => s.id);
      this.strokes = this.strokes.filter((s) => !ids.has(s.id));
      for (const id of ids) {
        this.strokeById.delete(id);
        this.strokeBounds.delete(id);
        this.selection.strokeIds.delete(id);
      }
      if (existing.length > 0) this.persistence.deleteStrokes(existing);
    }
    if (mutation.updatedStrokes?.length) {
      const map = new Map(mutation.updatedStrokes.map((u) => [u.after.id, u.after]));
      this.strokes = this.strokes.map((s) => map.get(s.id) ?? s);
      for (const update of mutation.updatedStrokes) {
        this.strokeById.set(update.after.id, update.after);
        this.strokeBounds.delete(update.after.id);
      }
      this.persistence.updateStrokes(mutation.updatedStrokes.map((u) => u.after));
    }
    if (mutation.addedStrokes?.length) {
      const fresh = mutation.addedStrokes.filter((s) => !this.strokeById.has(s.id));
      for (const stroke of fresh) {
        this.strokes.push(stroke);
        this.strokeById.set(stroke.id, stroke);
        this.strokeBounds.delete(stroke.id);
      }
      if (fresh.length > 0) this.persistence.addStrokes(fresh);
    }

    if (mutation.removedTexts?.length) {
      const ids = new Set(mutation.removedTexts.map((t) => t.id));
      const existing = this.texts.filter((t) => ids.has(t.id)).map((t) => t.id);
      this.texts = this.texts.filter((t) => !ids.has(t.id));
      for (const id of ids) this.selection.textIds.delete(id);
      if (existing.length > 0) this.persistence.deleteTexts(existing);
    }
    if (mutation.updatedTexts?.length) {
      const ids = new Set(this.texts.map((t) => t.id));
      const updates = mutation.updatedTexts.filter((u) => ids.has(u.after.id));
      const map = new Map(updates.map((u) => [u.after.id, u.after]));
      this.texts = this.texts.map((t) => map.get(t.id) ?? t);
      if (updates.length > 0) this.persistence.updateTexts(updates.map((u) => u.after));
    }
    if (mutation.addedTexts?.length) {
      const existingIds = new Set(this.texts.map((t) => t.id));
      const fresh = mutation.addedTexts.filter((t) => !existingIds.has(t.id));
      this.texts.push(...fresh);
      if (fresh.length > 0) this.persistence.addTexts(fresh);
    }

    if (mutation.removedImages?.length) {
      const ids = new Set(mutation.removedImages.map((i) => i.id));
      const existing = this.images.filter((i) => ids.has(i.id)).map((i) => i.id);
      this.images = this.images.filter((i) => !ids.has(i.id));
      for (const id of ids) this.selection.imageIds.delete(id);
      if (existing.length > 0) this.persistence.deleteImages(existing);
    }
    if (mutation.updatedImages?.length) {
      const ids = new Set(this.images.map((i) => i.id));
      const updates = mutation.updatedImages.filter((u) => ids.has(u.after.id));
      const map = new Map(updates.map((u) => [u.after.id, u.after]));
      this.images = this.images.map((i) => map.get(i.id) ?? i);
      if (updates.length > 0) this.persistence.updateImages(updates.map((u) => u.after));
    }
    if (mutation.addedImages?.length) {
      const existingIds = new Set(this.images.map((i) => i.id));
      const fresh = mutation.addedImages.filter((i) => !existingIds.has(i.id));
      this.images.push(...fresh);
      if (fresh.length > 0) this.persistence.addImages(fresh);
    }

    this.invalidateInk();
    this.selectionChanged();

    if (record) {
      const inverse = invertMutation(mutation);
      this.history.push({
        label: mutation.label,
        undo: async () => this.applyMutation(inverse, { record: false }),
        redo: async () => this.applyMutation(mutation, { record: false }),
      });
    }
    this.persistence.notifyChange();
  }

  private commitStrokes(strokes: Stroke[], label: string): void {
    if (strokes.length === 0) return;
    this.applyMutation({ label, addedStrokes: strokes });
  }

  /* ---------------------------------------------------------------- */
  /* Eraser                                                            */
  /* ---------------------------------------------------------------- */

  private eraseSegment(from: StrokePoint, to: StrokePoint, radius: number): void {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(distance / Math.max(2, radius / 2)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.eraseAt(
        {
          x: from.x + (to.x - from.x) * t,
          y: from.y + (to.y - from.y) * t,
          pressure: 0.5,
          tiltX: 0,
          tiltY: 0,
          timestamp: to.timestamp,
        },
        radius,
      );
    }
  }

  /** Erases at one contact point; the drag is recorded as a single undo step. */
  private eraseAt(point: StrokePoint, radius: number): void {
    const removed: Stroke[] = [];
    const added: Stroke[] = [];
    const mode = this.toolSettings.eraser.mode;
    for (const stroke of this.strokes) {
      const reach = radius + stroke.width / 2;
      const bounds = this.boundsFor(stroke);
      if (
        point.x < bounds.minX - reach ||
        point.x > bounds.maxX + reach ||
        point.y < bounds.minY - reach ||
        point.y > bounds.maxY + reach
      ) {
        continue;
      }
      if (polylineDistance(stroke.points, point.x, point.y) > reach) continue;
      if (mode === 'stroke' || stroke.shape || stroke.points.length < 3) {
        removed.push(stroke);
        continue;
      }
      const segments = splitStrokeAround(stroke, point, reach);
      removed.push(stroke);
      added.push(...segments);
    }
    if (removed.length === 0) return;
    this.applyMutation({ label: 'Erase', removedStrokes: removed, addedStrokes: added }, { record: false });
  }

  /** Pushes one undo entry for the whole eraser drag. */
  private commitErase(before: Stroke[]): void {
    const afterIds = new Set(this.strokes.map((s) => s.id));
    const beforeIds = new Set(before.map((s) => s.id));
    const removed = before.filter((s) => !afterIds.has(s.id));
    const added = this.strokes.filter((s) => !beforeIds.has(s.id));
    if (removed.length === 0 && added.length === 0) {
      this.invalidateInk();
      return;
    }
    this.history.push({
      label: 'Erase',
      undo: async () =>
        this.applyMutation({ label: 'Erase', addedStrokes: removed, removedStrokes: added }, { record: false }),
      redo: async () =>
        this.applyMutation({ label: 'Erase', addedStrokes: added, removedStrokes: removed }, { record: false }),
    });
    this.invalidateInk();
  }

  /* ---------------------------------------------------------------- */
  /* Selection                                                         */
  /* ---------------------------------------------------------------- */

  private hasSelection(): boolean {
    return this.selection.strokeIds.size + this.selection.textIds.size + this.selection.imageIds.size > 0;
  }

  private selectionBounds(): Bounds | null {
    if (!this.hasSelection()) return null;
    const points: { x: number; y: number }[] = [];
    for (const id of this.selection.strokeIds) {
      const stroke = this.strokeById.get(id);
      if (stroke) points.push(...stroke.points);
    }
    for (const id of this.selection.textIds) {
      const text = this.texts.find((t) => t.id === id);
      if (text) {
        points.push(
          { x: text.x, y: text.y },
          { x: text.x + text.width, y: text.y + text.fontSize * 1.4 },
        );
      }
    }
    for (const id of this.selection.imageIds) {
      const image = this.images.find((i) => i.id === id);
      if (image) {
        points.push({ x: image.x, y: image.y }, { x: image.x + image.width, y: image.y + image.height });
      }
    }
    if (points.length === 0) return null;
    return boundsOfPoints(points, 6);
  }

  private selectionChanged(): void {
    this.callbacks.onSelectionChange({
      count: this.selection.strokeIds.size + this.selection.textIds.size + this.selection.imageIds.size,
      bounds: this.selectionBounds(),
    });
    this.invalidateLive();
  }

  private selectInsidePolygon(polygon: { x: number; y: number }[]): void {
    const selection: Selection = { strokeIds: new Set(), textIds: new Set(), imageIds: new Set() };
    for (const stroke of this.strokes) {
      if (stroke.points.some((p) => pointInPolygon(p.x, p.y, polygon))) selection.strokeIds.add(stroke.id);
    }
    for (const text of this.texts) {
      if (pointInPolygon(text.x + text.width / 2, text.y + text.fontSize * 0.7, polygon)) {
        selection.textIds.add(text.id);
      }
    }
    for (const image of this.images) {
      if (pointInPolygon(image.x + image.width / 2, image.y + image.height / 2, polygon)) {
        selection.imageIds.add(image.id);
      }
    }
    this.selection = selection;
    this.selectionChanged();
    if (selection.textIds.size === 1 && selection.strokeIds.size === 0 && selection.imageIds.size === 0) {
      const id = [...selection.textIds][0]!;
      const draft = this.textDraftFor(id);
      if (draft) this.callbacks.requestTextEdit(draft);
    }
  }

  private selectionContains(point: { x: number; y: number }): boolean {
    const bounds = this.selectionBounds();
    if (!bounds) return false;
    return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
  }

  private hitResizeHandle(local: { x: number; y: number }): boolean {
    const bounds = this.selectionBounds();
    if (!bounds) return false;
    const handle = this.toScreen(bounds.maxX, bounds.maxY);
    return Math.hypot(local.x - handle.x, local.y - handle.y) <= HANDLE_SCREEN_SIZE;
  }

  private beginMove(point: StrokePoint): void {
    this.session = {
      kind: 'move',
      start: { x: point.x, y: point.y },
      last: { x: point.x, y: point.y },
      strokes: this.strokes
        .filter((s) => this.selection.strokeIds.has(s.id))
        .map((s) => ({ ...s, points: s.points.map((p) => ({ ...p })) })),
      texts: this.texts.filter((t) => this.selection.textIds.has(t.id)).map((t) => ({ ...t })),
      images: this.images.filter((i) => this.selection.imageIds.has(i.id)).map((i) => ({ ...i })),
    };
  }

  private beginResize(point: StrokePoint): void {
    const bounds = this.selectionBounds();
    if (!bounds) return;
    this.resizeStartX = point.x;
    this.resizeStartY = point.y;
    this.session = {
      kind: 'resize',
      origin: { x: bounds.minX, y: bounds.minY },
      last: { x: point.x, y: point.y },
      strokes: this.strokes
        .filter((s) => this.selection.strokeIds.has(s.id))
        .map((s) => ({ ...s, points: s.points.map((p) => ({ ...p })) })),
      texts: this.texts.filter((t) => this.selection.textIds.has(t.id)).map((t) => ({ ...t })),
      images: this.images.filter((i) => this.selection.imageIds.has(i.id)).map((i) => ({ ...i })),
    };
  }

  private translateSelection(dx: number, dy: number): void {
    if (this.session.kind !== 'move') return;
    const { strokes, texts, images } = this.session;
    const strokeIds = new Set(strokes.map((s) => s.id));
    const textIds = new Set(texts.map((t) => t.id));
    const imageIds = new Set(images.map((i) => i.id));
    this.strokes = this.strokes.map((stroke) => {
      if (!strokeIds.has(stroke.id)) return stroke;
      const updated: Stroke = {
        ...stroke,
        points: stroke.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
      };
      this.strokeById.set(updated.id, updated);
      this.strokeBounds.delete(updated.id);
      return updated;
    });
    this.texts = this.texts.map((text) =>
      textIds.has(text.id) ? { ...text, x: text.x + dx, y: text.y + dy } : text,
    );
    this.images = this.images.map((image) =>
      imageIds.has(image.id) ? { ...image, x: image.x + dx, y: image.y + dy } : image,
    );
  }

  private scaleSelection(origin: { x: number; y: number }, factor: number): void {
    if (this.session.kind !== 'resize') return;
    const session = this.session;
    const clamp = Math.max(0.1, Math.min(10, factor));
    const base = (x: number, y: number) => ({
      x: origin.x + (x - origin.x) * clamp,
      y: origin.y + (y - origin.y) * clamp,
    });

    const strokeBase = new Map(session.strokes.map((s) => [s.id, s]));
    this.strokes = this.strokes.map((stroke) => {
      const source = strokeBase.get(stroke.id);
      if (!source) return stroke;
      const updated: Stroke = {
        ...stroke,
        width: Math.max(0.4, source.width * clamp),
        points: source.points.map((p) => {
          const scaled = base(p.x, p.y);
          return { ...p, x: scaled.x, y: scaled.y };
        }),
      };
      this.strokeById.set(updated.id, updated);
      this.strokeBounds.delete(updated.id);
      return updated;
    });
    const textBase = new Map(session.texts.map((t) => [t.id, t]));
    this.texts = this.texts.map((text) => {
      const source = textBase.get(text.id);
      if (!source) return text;
      const scaled = base(source.x, source.y);
      return {
        ...text,
        x: scaled.x,
        y: scaled.y,
        width: Math.max(40, source.width * clamp),
        fontSize: Math.max(6, source.fontSize * clamp),
      };
    });
    const imageBase = new Map(session.images.map((i) => [i.id, i]));
    this.images = this.images.map((image) => {
      const source = imageBase.get(image.id);
      if (!source) return image;
      const scaled = base(source.x, source.y);
      return {
        ...image,
        x: scaled.x,
        y: scaled.y,
        width: Math.max(8, source.width * clamp),
        height: Math.max(8, source.height * clamp),
      };
    });
  }

  private commitTransform(
    session: Extract<Session, { kind: 'move' } | { kind: 'resize' }>,
    label: string,
  ): void {
    const updatedStrokes: { before: Stroke; after: Stroke }[] = [];
    for (const before of session.strokes) {
      const after = this.strokeById.get(before.id);
      if (after && !sameStroke(before, after)) updatedStrokes.push({ before, after });
    }
    const updatedTexts: { before: TextBlock; after: TextBlock }[] = [];
    for (const before of session.texts) {
      const after = this.texts.find((t) => t.id === before.id);
      if (after && !sameText(before, after)) updatedTexts.push({ before, after });
    }
    const updatedImages: { before: ImagePlacement; after: ImagePlacement }[] = [];
    for (const before of session.images) {
      const after = this.images.find((i) => i.id === before.id);
      if (after && !sameImage(before, after)) updatedImages.push({ before, after });
    }
    if (updatedStrokes.length + updatedTexts.length + updatedImages.length === 0) {
      this.invalidateInk();
      return;
    }
    this.applyMutation({ label, updatedStrokes, updatedTexts, updatedImages });
  }

  clearSelection(): void {
    if (!this.hasSelection()) return;
    this.selection = { strokeIds: new Set(), textIds: new Set(), imageIds: new Set() };
    this.selectionChanged();
  }

  selectAll(): void {
    this.selection = {
      strokeIds: new Set(this.strokes.map((s) => s.id)),
      textIds: new Set(this.texts.map((t) => t.id)),
      imageIds: new Set(this.images.map((i) => i.id)),
    };
    this.selectionChanged();
  }

  selectionCount(): number {
    return this.selection.strokeIds.size + this.selection.textIds.size + this.selection.imageIds.size;
  }

  deleteSelection(): void {
    if (!this.hasSelection()) return;
    const removedStrokes = this.strokes.filter((s) => this.selection.strokeIds.has(s.id));
    const removedTexts = this.texts.filter((t) => this.selection.textIds.has(t.id));
    const removedImages = this.images.filter((i) => this.selection.imageIds.has(i.id));
    this.applyMutation({ label: 'Delete selection', removedStrokes, removedTexts, removedImages });
    this.clearSelection();
  }

  copySelection(): boolean {
    if (!this.hasSelection()) return false;
    this.clipboard = {
      strokes: this.strokes
        .filter((s) => this.selection.strokeIds.has(s.id))
        .map((s) => ({ ...s, points: s.points.map((p) => ({ ...p })) })),
      texts: this.texts.filter((t) => this.selection.textIds.has(t.id)).map((t) => ({ ...t })),
      images: this.images.filter((i) => this.selection.imageIds.has(i.id)).map((i) => ({ ...i })),
    };
    return true;
  }

  paste(): boolean {
    if (!this.clipboard || !this.page) return false;
    const offset = 18;
    const t = now();
    const pageId = this.page.id;
    const strokes = this.clipboard.strokes.map((s) => ({
      ...s,
      id: newId(),
      pageId,
      points: s.points.map((p) => ({ ...p, x: p.x + offset, y: p.y + offset })),
      createdAt: t,
      updatedAt: t,
      version: 1,
      deletedAt: null,
    }));
    const texts = this.clipboard.texts.map((x) => ({
      ...x,
      id: newId(),
      pageId,
      x: x.x + offset,
      y: x.y + offset,
      createdAt: t,
      updatedAt: t,
      version: 1,
      deletedAt: null,
    }));
    const images = this.clipboard.images.map((i) => ({
      ...i,
      id: newId(),
      pageId,
      x: i.x + offset,
      y: i.y + offset,
      createdAt: t,
      updatedAt: t,
      version: 1,
      deletedAt: null,
    }));
    this.applyMutation({ label: 'Paste', addedStrokes: strokes, addedTexts: texts, addedImages: images });
    this.selection = {
      strokeIds: new Set(strokes.map((s) => s.id)),
      textIds: new Set(texts.map((x) => x.id)),
      imageIds: new Set(images.map((i) => i.id)),
    };
    this.selectionChanged();
    return true;
  }

  hasClipboard(): boolean {
    return this.clipboard !== null;
  }

  /* ---------------------------------------------------------------- */
  /* Text and images                                                   */
  /* ---------------------------------------------------------------- */

  commitText(draft: TextDraft): void {
    if (!this.page) return;
    const t = now();
    if (draft.text.trim().length === 0) {
      if (draft.id) {
        const existing = this.texts.find((x) => x.id === draft.id);
        if (existing) this.applyMutation({ label: 'Delete text', removedTexts: [existing] });
      }
      return;
    }
    if (draft.id) {
      const before = this.texts.find((x) => x.id === draft.id);
      if (!before) return;
      const after: TextBlock = {
        ...before,
        text: draft.text,
        fontSize: draft.fontSize,
        color: draft.color,
        width: draft.width,
        align: draft.align,
        updatedAt: t,
        version: before.version + 1,
      };
      this.applyMutation({ label: 'Edit text', updatedTexts: [{ before, after }] });
    } else {
      this.applyMutation({
        label: 'Add text',
        addedTexts: [
          {
            id: newId(),
            pageId: this.page.id,
            x: draft.x,
            y: draft.y,
            width: draft.width,
            text: draft.text,
            fontSize: draft.fontSize,
            color: draft.color,
            align: draft.align,
            createdAt: t,
            updatedAt: t,
            version: 1,
            deviceId: '',
            deletedAt: null,
          },
        ],
      });
    }
  }

  textDraftFor(id: string): TextDraft | null {
    const text = this.texts.find((t) => t.id === id);
    if (!text) return null;
    return {
      id: text.id,
      x: text.x,
      y: text.y,
      width: text.width,
      text: text.text,
      fontSize: text.fontSize,
      color: text.color,
      align: text.align,
    };
  }

  addImage(assetId: string, image: CanvasImageSource, naturalWidth: number, naturalHeight: number): void {
    if (!this.page) return;
    this.setImageBitmap(assetId, image);
    const size = this.pageSize();
    const ratio = Math.min(
      (size.width * 0.6) / naturalWidth,
      (size.height * 0.6) / naturalHeight,
      1,
    );
    const w = naturalWidth * ratio;
    const h = naturalHeight * ratio;
    const center = this.toDoc(this.cssWidth / 2, this.cssHeight / 2);
    const t = now();
    const placement: ImagePlacement = {
      id: newId(),
      pageId: this.page.id,
      assetId,
      x: center.x - w / 2,
      y: center.y - h / 2,
      width: w,
      height: h,
      createdAt: t,
      updatedAt: t,
      version: 1,
      deviceId: '',
      deletedAt: null,
    };
    this.applyMutation({ label: 'Insert image', addedImages: [placement] });
    this.selection = { strokeIds: new Set(), textIds: new Set(), imageIds: new Set([placement.id]) };
    this.selectionChanged();
  }

  /* ---------------------------------------------------------------- */
  /* Host commands                                                     */
  /* ---------------------------------------------------------------- */

  setTool(tool: DrawToolId): void {
    this.tool = tool;
    this.clearSelection();
    this.invalidateLive();
  }

  setToolSettings(settings: ToolSettings): void {
    this.toolSettings = settings;
  }

  setShowBoundary(value: boolean): void {
    this.showBoundary = value;
    this.pendingPaper = true;
    this.pendingInk = true;
    this.schedule();
  }

  async undo(): Promise<void> {
    this.clearSelection();
    await this.history.undo();
  }

  async redo(): Promise<void> {
    this.clearSelection();
    await this.history.redo();
  }

  private makeShapeStroke(start: StrokePoint, end: StrokePoint): Stroke {
    const settings =
      this.toolSettings[this.tool as 'line' | 'rect' | 'circle' | 'arrow'] ?? this.toolSettings.line;
    return {
      id: 'preview',
      pageId: this.page?.id ?? '',
      tool: this.tool,
      color: settings.color,
      width: settings.width,
      opacity: settings.opacity,
      points: [start, end],
      shape: this.tool as 'line' | 'rect' | 'circle' | 'arrow',
      createdAt: 0,
      updatedAt: 0,
      version: 1,
      deviceId: '',
      deletedAt: null,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function invertMutation(m: Mutation): Mutation {
  return {
    label: `Undo ${m.label.toLowerCase()}`,
    addedStrokes: m.removedStrokes,
    removedStrokes: m.addedStrokes,
    updatedStrokes: m.updatedStrokes?.map((u) => ({ before: u.after, after: u.before })),
    addedTexts: m.removedTexts,
    removedTexts: m.addedTexts,
    updatedTexts: m.updatedTexts?.map((u) => ({ before: u.after, after: u.before })),
    addedImages: m.removedImages,
    removedImages: m.addedImages,
    updatedImages: m.updatedImages?.map((u) => ({ before: u.after, after: u.before })),
  };
}

function sameStroke(a: Stroke, b: Stroke): boolean {
  if (a.width !== b.width || a.points.length !== b.points.length) return false;
  for (let i = 0; i < a.points.length; i++) {
    const p = a.points[i]!;
    const q = b.points[i]!;
    if (p.x !== q.x || p.y !== q.y) return false;
  }
  return true;
}

function sameText(a: TextBlock, b: TextBlock): boolean {
  return a.x === b.x && a.y === b.y && a.text === b.text && a.width === b.width && a.fontSize === b.fontSize;
}

function sameImage(a: ImagePlacement, b: ImagePlacement): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function localFromStage(stage: HTMLElement, e: PointerEvent): { x: number; y: number } {
  const rect = stage.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}


/** Splits a stroke around an eraser contact, preserving the surviving runs. */
export function splitStrokeAround(
  stroke: Stroke,
  point: { x: number; y: number },
  reach: number,
): Stroke[] {
  const runs: StrokePoint[][] = [];
  let current: StrokePoint[] = [];
  for (const p of stroke.points) {
    if (Math.hypot(p.x - point.x, p.y - point.y) <= reach) {
      if (current.length >= 2) runs.push(current);
      current = [];
    } else {
      current.push(p);
    }
  }
  if (current.length >= 2) runs.push(current);
  return runs.map((points, index) => ({
    ...stroke,
    id: newId(),
    points,
    createdAt: stroke.createdAt + index,
    updatedAt: now(),
    version: 1,
    deletedAt: null,
  }));
}
