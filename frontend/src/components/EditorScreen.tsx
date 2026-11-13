import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft,
  Calculator,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  Copy,
  CopyPlus,
  Pencil,
  Minus,
  MoreHorizontal,
  Plus,
  Trash2,
  Wand2,
} from 'lucide-react';
import { db } from '../storage/db';
import type {
  DrawToolId,
  EquationPlacement,
  GraphObject,
  Page,
  TableObject,
  ToolSettings,
} from '../storage/types';
import { DEFAULT_TOOL_SETTINGS } from '../storage/types';
import {
  activePages,
  deletePage,
  getSettings,
  loadPageContent,
  markOutbox,
  newRichEnvelope,
  removeRich,
  saveSettings,
  saveRich,
  touch,
} from '../storage/repo';
import { PageWriteBuffer, createPagePersistence } from '../storage/pageStore';
import { DrawingEngine, type PageContent, type ShapeSuggestion, type TextDraft } from '../drawing/engine';
import { renderPage } from '../drawing/renderPage';
import { loadPdf, renderPdfPage, type PDFDocumentProxy } from '../pdf/loader';
import { saveImageAsset } from '../storage/assets';
import { exportPagePng } from '../export/exporters';
import { navigate } from '../app/router';
import { syncStatus } from '../sync/store';
import { loadTypesetter } from '../rich/mathTypeset';
import { IconButton, Modal, cx } from './ui';
import { Toolbar } from './Toolbar';
import { InsertSheet } from './InsertSheet';
import { EquationPanel, type EquationDraft } from '../rich/EquationPanel';
import { GraphPanel, type GraphDraft } from '../graph/GraphPanel';
import { TablePanel, type TableDraft } from '../rich/TablePanel';
import { CalculatorPanel } from '../tools/CalculatorPanel';
import { RichLayer, type RichObjects, type RichSelection } from '../rich/RichLayer';
import { getRichClipboard, setRichClipboard } from '../rich/clipboard';

export function EditorScreen({ pageId }: { pageId: string }) {
  const page = useLiveQuery(() => db.pages.get(pageId), [pageId]);
  const notebook = useLiveQuery(
    async () => (page ? db.notebooks.get(page.notebookId) : undefined),
    [page?.notebookId],
  );
  const pages = useLiveQuery(
    async () => (page ? activePages(page.notebookId) : []),
    [page?.notebookId],
  );
  const status = useSyncExternalStore(syncStatus.subscribe, syncStatus.getSnapshot);

  const stageRef = useRef<HTMLDivElement>(null);
  const insertStagger = useRef(0);
  const engineRef = useRef<DrawingEngine | null>(null);
  const bufferRef = useRef<PageWriteBuffer | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pdfCache = useRef<{ key: string; doc: PDFDocumentProxy } | null>(null);
  const settingsRef = useRef<ToolSettings>(DEFAULT_TOOL_SETTINGS);

  const [toolSettings, setToolSettings] = useState<ToolSettings>(DEFAULT_TOOL_SETTINGS);
  const [tool, setTool] = useState<DrawToolId>('fountain');
  const [scale, setScale] = useState(1);
  const [pdfScale, setPdfScale] = useState(1);
  const [selectionCount, setSelectionCount] = useState(0);
  const [hasClipboard, setHasClipboard] = useState(false);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [toolbarPos, setToolbarPos] = useState<{ x: number; y: number } | null>(null);
  const [changeTick, setChangeTick] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [paperOpen, setPaperOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const [selected, setSelected] = useState<RichSelection>(null);
  const [insertOpen, setInsertOpen] = useState(false);
  const [suggestion, setSuggestion] = useState<ShapeSuggestion | null>(null);
  const [panel, setPanel] = useState<{
    kind: 'equation' | 'graph' | 'table' | 'calculator';
    editing: EquationPlacement | GraphObject | TableObject | null;
    prefill?: string;
  } | null>(null);

  const equationRows = useLiveQuery(() => db.equations.where('pageId').equals(pageId).toArray(), [pageId]);
  const graphRows = useLiveQuery(() => db.graphs.where('pageId').equals(pageId).toArray(), [pageId]);
  const tableRows = useLiveQuery(() => db.tableObjects.where('pageId').equals(pageId).toArray(), [pageId]);

  const objects = useMemo<RichObjects>(
    () => ({
      equations: (equationRows ?? []).filter((row) => row.deletedAt === null),
      graphs: (graphRows ?? []).filter((row) => row.deletedAt === null),
      tables: (tableRows ?? []).filter((row) => row.deletedAt === null),
    }),
    [equationRows, graphRows, tableRows],
  );

  const viewTimer = useRef<number | null>(null);
  const toolbarSaveTimer = useRef<number | null>(null);

  const loadAssetBitmaps = useCallback(async (content: PageContent, engine: DrawingEngine) => {
    const seen = new Set<string>();
    for (const placement of content.images) {
      if (seen.has(placement.assetId)) continue;
      seen.add(placement.assetId);
      const asset = await db.assets.get(placement.assetId);
      if (!asset) continue;
      try {
        const bitmap = await createImageBitmap(asset.blob);
        engine.setImageBitmap(placement.assetId, bitmap);
      } catch {
        // Ignore undecodable images; the engine renders a placeholder box.
      }
    }
  }, []);

  const renderPdfInto = useCallback(
    async (target: Page, engine: DrawingEngine, zoom: number) => {
      if (!target.pdfAssetId) {
        engine.setPdfBitmap(null);
        return;
      }
      const asset = await db.assets.get(target.pdfAssetId);
      if (!asset) return;
      try {
        if (pdfCache.current?.key !== asset.id + ':' + asset.sha256) {
          await pdfCache.current?.doc.destroy().catch(() => undefined);
          pdfCache.current = { key: asset.id + ':' + asset.sha256, doc: await loadPdf(asset.blob) };
        }
        const doc = pdfCache.current.doc;
        const dpr = Math.min(2.5, window.devicePixelRatio || 1);
        const ratio = Math.min(6, Math.max(1, (150 / 72) * zoom * dpr));
        const rendered = await renderPdfPage(doc, target.pdfPageIndex, ratio);
        engine.setPdfBitmap(rendered.canvas, rendered.canvas.width, rendered.canvas.height);
      } catch (error) {
        console.warn('PDF rendering failed', error);
        setToast('This PDF page could not be rendered. Annotations are still saved.');
      }
    },
    [],
  );

  useEffect(() => {
    if (!page || !stageRef.current) return;
    const stage = stageRef.current;
    const buffer = new PageWriteBuffer(() => setChangeTick((tick) => tick + 1));
    bufferRef.current = buffer;
    let cancelled = false;

    const engine = new DrawingEngine(
      stage,
      createPagePersistence(buffer),
      {
        onSelectionChange: (selection) => setSelectionCount(selection.count),
        onHistoryChange: () =>
          setHistoryState({
            canUndo: engineRef.current?.history.canUndo ?? false,
            canRedo: engineRef.current?.history.canRedo ?? false,
          }),
        onViewChange: (view) => {
          setScale(view.scale);
          setView(view);
          if (viewTimer.current !== null) window.clearTimeout(viewTimer.current);
          viewTimer.current = window.setTimeout(() => {
            setPdfScale(Math.round(view.scale * 2) / 2);
          }, 220);
        },
        requestTextEdit: (draft) => setTextDraft(draft),
        requestImage: () => imageInputRef.current?.click(),
        onShapeSuggestion: (next) => setSuggestion(next),
      },
      settingsRef.current,
    );
    engineRef.current = engine;

    void (async () => {
      const [content, prefs] = await Promise.all([loadPageContent(page.id), getSettings()]);
      if (cancelled) return;
      engine.oneFingerPan = prefs.oneFingerPan;
      engine.palmRejection = prefs.palmRejection;
      engine.showBoundary = prefs.showPageBoundary;
      engine.setSnapping(prefs.snapEnabled, prefs.gridSpacing);
      engine.setRecognition(prefs.recognizeShapes);
      setCollapsed(prefs.toolbarCollapsed);
      setToolbarPos(prefs.toolbarPosition);
      engine.setPage(page, content);
      engine.setTool(tool);
      await loadAssetBitmaps(content, engine);
      await renderPdfInto(page, engine, 1);

      const draft = await db.drafts.get(page.id);
      if (draft && Date.now() - draft.savedAt < 7 * 86_400_000) {
        const exists = await db.strokes.get(draft.stroke.id);
        if (!exists) {
          engine.restoreDraft({ ...draft.stroke, pageId: page.id });
          setToast('Recovered unsaved stroke from the last session');
        }
      }
    })();

    return () => {
      cancelled = true;
      engine.dispose();
      engineRef.current = null;
      if (viewTimer.current !== null) window.clearTimeout(viewTimer.current);
      void buffer.flush();
      bufferRef.current = null;
    };
    // The engine is recreated only when the page identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id]);

  useEffect(() => {
    settingsRef.current = toolSettings;
    engineRef.current?.setToolSettings(toolSettings);
  }, [toolSettings]);

  useEffect(() => {
    engineRef.current?.setTool(tool);
  }, [tool]);

  useEffect(() => {
    if (!page?.pdfAssetId) return;
    const engine = engineRef.current;
    if (!engine) return;
    void renderPdfInto(page, engine, pdfScale);
  }, [page?.pdfAssetId, page?.pdfPageIndex, page?.id, pdfScale, renderPdfInto]);

  useEffect(() => {
    return () => {
      const doc = pdfCache.current?.doc;
      pdfCache.current = null;
      void doc?.destroy().catch(() => undefined);
    };
  }, []);

  // Draft autosave: keeps an in-flight stroke recoverable after a crash.
  useEffect(() => {
    if (!page) return;
    const timer = window.setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      const active = engine.getActiveStroke();
      if (active && active.points.length > 1) {
        void db.drafts.put({ pageId: page.id, stroke: { ...active }, savedAt: Date.now() });
      } else {
        void db.drafts.delete(page.id);
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [page?.id]);

  // Thumbnail refresh, debounced so writing is never interrupted.
  useEffect(() => {
    if (!page || changeTick === 0) return;
    const timer = window.setTimeout(() => {
      const engine = engineRef.current;
      if (!engine) return;
      const snapshot = engine.snapshot();
      void (async () => {
        await loadTypesetter();
        const bitmaps = new Map<string, CanvasImageSource>();
        for (const placement of snapshot.images) {
          if (bitmaps.has(placement.assetId)) continue;
          const asset = await db.assets.get(placement.assetId);
          if (!asset) continue;
          try {
            bitmaps.set(placement.assetId, await createImageBitmap(asset.blob));
          } catch {
            /* ignore */
          }
        }
        let pdfCanvas: CanvasImageSource | null = null;
        if (page.pdfAssetId && pdfCache.current) {
          try {
            const rendered = await renderPdfPage(pdfCache.current.doc, page.pdfPageIndex, 0.45);
            pdfCanvas = rendered.canvas;
          } catch {
            pdfCanvas = null;
          }
        }
        const width = 260;
        const scaleFactor = page.size === 'infinite' ? 0.2 : width / page.width;
        const rendered = renderPage({
          page,
          strokes: snapshot.strokes,
          texts: snapshot.texts,
          images: snapshot.images,
          equations: objects.equations,
          graphs: objects.graphs,
          tables: objects.tables,
          assetBitmaps: bitmaps,
          pdfCanvas,
          scale: scaleFactor,
          background: true,
          tint: page.backgroundTint,
          showBoundary: true,
        });
        await db.thumbnails.put({
          pageId: page.id,
          dataUrl: rendered.canvas.toDataURL('image/jpeg', 0.72),
          updatedAt: Date.now(),
        });
      })();
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [
    changeTick,
    objects,
    page?.id,
    page?.pdfAssetId,
    page?.pdfPageIndex,
    page?.width,
    page?.size,
    page?.backgroundTint,
  ]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const engine = engineRef.current;
      if (!engine) return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) void engine.redo();
        else void engine.undo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'c') {
        if (engine.copySelection()) setHasClipboard(true);
        else if (selected) copyRich(selected.kind, selected.id);
        return;
      }
      if (mod && event.key.toLowerCase() === 'v') {
        if (engine.paste()) {
          setHasClipboard(false);
          return;
        }
        if (getRichClipboard()) void pasteRich();
        return;
      }
      if (mod && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        setPanel({ kind: 'equation', editing: null });
        return;
      }
      if (mod && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        setPanel({ kind: 'graph', editing: null });
        return;
      }
      if (mod && event.key.toLowerCase() === 'd' && selected) {
        event.preventDefault();
        void duplicateRich(selected.kind, selected.id);
        return;
      }
      if (mod && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        engine.selectAll();
        return;
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        if (selected) {
          event.preventDefault();
          void deleteRich(selected.kind, selected.id);
          return;
        }
        if (engine.selectionCount() > 0) {
          event.preventDefault();
          engine.deleteSelection();
        }
        return;
      }
      if (event.key === 'Escape') {
        engine.clearSelection();
        setSelected(null);
        setPanel(null);
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page?.id]);

  const index = useMemo(() => (pages ?? []).findIndex((p) => p.id === pageId), [pages, pageId]);
  const prevPage = index > 0 ? (pages ?? [])[index - 1] : undefined;
  const nextPage = index >= 0 ? (pages ?? [])[index + 1] : undefined;

  async function handleImageFile(file: File): Promise<void> {
    try {
      const asset = await saveImageAsset(file);
      const bitmap = await createImageBitmap(asset.blob);
      engineRef.current?.addImage(asset.id, bitmap, bitmap.width, bitmap.height);
      setChangeTick((tick) => tick + 1);
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Image could not be added');
    }
  }

  function persistToolbar(patch: { collapsed?: boolean; position?: { x: number; y: number } | null }): void {
    void saveSettings({
      toolbarCollapsed: patch.collapsed ?? collapsed,
      toolbarPosition: patch.position === undefined ? toolbarPos : patch.position,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Rich objects                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Centre of the visible page area, stepped down a little on each insert so a
   * new object does not land exactly on top of the previous one.
   */
  function insertPoint(): { x: number; y: number } {
    const stage = stageRef.current;
    const width = stage?.clientWidth ?? window.innerWidth;
    const height = stage?.clientHeight ?? window.innerHeight;
    const centreX = (width / 2 - view.tx) / view.scale;
    const centreY = (height / 2 - view.ty) / view.scale;
    const offset = (insertStagger.current++ % 6) * 36;
    return { x: centreX + offset, y: centreY + offset };
  }

  function findRich(kind: 'equation' | 'graph' | 'table', id: string): EquationPlacement | GraphObject | TableObject | null {
    if (kind === 'equation') return objects.equations.find((item) => item.id === id) ?? null;
    if (kind === 'graph') return objects.graphs.find((item) => item.id === id) ?? null;
    return objects.tables.find((item) => item.id === id) ?? null;
  }

  async function insertEquation(draft: EquationDraft): Promise<void> {
    const centre = insertPoint();
    const width = Math.min(660, Math.max(300, (page?.width || 1240) * 0.55));
    const envelope = await newRichEnvelope();
    const equation: EquationPlacement = {
      ...envelope,
      pageId,
      latex: draft.latex,
      x: Math.round(centre.x - width / 2),
      y: Math.round(centre.y - 30),
      width: Math.round(width),
      fontSize: draft.fontSize,
      color: draft.color,
      align: draft.align,
      label: draft.label,
    };
    await saveRich('equation', equation);
    setSelected({ kind: 'equation', id: equation.id });
    setPanel(null);
  }

  async function insertGraph(draft: GraphDraft): Promise<void> {
    const centre = insertPoint();
    const width = 640;
    const height = 430;
    const envelope = await newRichEnvelope();
    const graph: GraphObject = {
      ...envelope,
      ...draft,
      pageId,
      width,
      height,
      x: Math.round(centre.x - width / 2),
      y: Math.round(centre.y - height / 2),
    };
    await saveRich('graph', graph);
    setSelected({ kind: 'graph', id: graph.id });
    setPanel(null);
  }

  async function insertTable(draft: TableDraft): Promise<void> {
    const centre = insertPoint();
    const envelope = await newRichEnvelope();
    const table: TableObject = {
      ...envelope,
      ...draft,
      pageId,
      x: Math.round(centre.x - draft.width / 2),
      y: Math.round(centre.y - 60),
    };
    await saveRich('table', table);
    setSelected({ kind: 'table', id: table.id });
    setPanel(null);
  }

  function openObject(kind: 'equation' | 'graph' | 'table', id: string): void {
    const source = findRich(kind, id);
    if (!source) return;
    setPanel({ kind, editing: source });
  }

  async function updateRich(
    kind: 'equation' | 'graph' | 'table',
    id: string,
    draft: EquationDraft | GraphDraft | TableDraft,
  ): Promise<void> {
    const source = findRich(kind, id);
    if (!source) return;
    await saveRich(kind, { ...source, ...draft });
    setPanel(null);
  }

  async function moveRich(kind: 'equation' | 'graph' | 'table', id: string, x: number, y: number): Promise<void> {
    const source = findRich(kind, id);
    if (!source) return;
    await saveRich(kind, { ...source, x: Math.round(x), y: Math.round(y) });
  }

  async function resizeRich(
    kind: 'equation' | 'graph' | 'table',
    id: string,
    width: number,
    height: number,
  ): Promise<void> {
    const source = findRich(kind, id);
    if (!source) return;
    if (kind === 'graph') {
      await saveRich('graph', { ...(source as GraphObject), width: Math.round(width), height: Math.round(height) });
      return;
    }
    if (kind === 'table') {
      const table = source as TableObject;
      const current = table.colWidths.reduce((sum, value) => sum + value, 0) || 1;
      const factor = width / current;
      await saveRich('table', {
        ...table,
        colWidths: table.colWidths.map((value) => Math.max(48, Math.round(value * factor))),
        width: Math.round(width),
      });
      return;
    }
    await saveRich('equation', { ...(source as EquationPlacement), width: Math.round(width) });
  }

  async function deleteRich(kind: 'equation' | 'graph' | 'table', id: string): Promise<void> {
    await removeRich(kind, id);
    setSelected(null);
  }

  async function duplicateRich(kind: 'equation' | 'graph' | 'table', id: string): Promise<void> {
    const source = findRich(kind, id);
    if (!source) return;
    const envelope = await newRichEnvelope();
    const copy = { ...source, ...envelope, x: source.x + 28, y: source.y + 28 };
    await saveRich(kind, copy);
    setSelected({ kind, id: copy.id });
  }

  function copyRich(kind: 'equation' | 'graph' | 'table', id: string): void {
    const source = findRich(kind, id);
    if (!source) return;
    if (kind === 'equation') setRichClipboard({ kind, data: source as EquationPlacement });
    else if (kind === 'graph') setRichClipboard({ kind, data: source as GraphObject });
    else setRichClipboard({ kind, data: source as TableObject });
    setToast('Copied — paste with the toolbar or ⌘V');
  }

  async function pasteRich(): Promise<void> {
    const payload = getRichClipboard();
    if (!payload) return;
    const envelope = await newRichEnvelope();
    const centre = insertPoint();
    const copy = { ...payload.data, ...envelope, pageId, x: Math.round(centre.x), y: Math.round(centre.y) };
    await saveRich(payload.kind, copy);
    setSelected({ kind: payload.kind, id: copy.id });
  }

  function insertTextAtCentre(text: string): void {
    const centre = insertPoint();
    engineRef.current?.commitText({
      id: null,
      x: Math.round(centre.x - 160),
      y: Math.round(centre.y - 12),
      width: 320,
      text,
      fontSize: toolSettings.text.fontSize,
      color: toolSettings.text.color,
      align: 'left',
    });
  }

  function handleInsertRequest(kind: string, latex?: string): void {
    setInsertOpen(false);
    if (kind === 'equation') setPanel({ kind: 'equation', editing: null, prefill: latex });
    else if (kind === 'graph') setPanel({ kind: 'graph', editing: null });
    else if (kind === 'table') setPanel({ kind: 'table', editing: null });
    else if (kind === 'text') insertTextAtCentre('');
    else if (kind === 'image') imageInputRef.current?.click();
    else if (kind === 'calculator') setPanel({ kind: 'calculator', editing: null });
  }

  if (!page) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center">
          <p className="font-serif text-[20px] text-ink">This page is unavailable</p>
          <button
            type="button"
            className="mt-3 text-[13px] text-accent underline"
            onClick={() => navigate('/')}
          >
            Return to library
          </button>
        </div>
      </div>
    );
  }

  const textScreen = textDraft && engineRef.current ? engineRef.current.toScreen(textDraft.x, textDraft.y) : null;

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-paper-sunken">
      <header className="safe-px z-20 flex items-center gap-2 border-b border-line bg-paper/95 py-2 pt-[max(0.5rem,var(--safe-top))] backdrop-blur">
        <IconButton label="Back to notebook" onClick={() => navigate(`/notebook/${page.notebookId}`)}>
          <ArrowLeft size={19} strokeWidth={1.8} />
        </IconButton>
        <div className="min-w-0 flex-1">
          <div className="truncate font-serif text-[16px] leading-tight text-ink">
            {notebook?.title ?? 'Notebook'}
          </div>
          <div className="flex items-center gap-2 text-[11.5px] text-ink-muted">
            <span>
              Page {index >= 0 ? index + 1 : 1} of {pages?.length ?? 1}
            </span>
            <span className="text-ink-faint">·</span>
            <span className="uppercase tracking-wide">{page.pdfAssetId ? 'PDF' : page.template}</span>
            {!status.online && (
              <span className="inline-flex items-center gap-1 text-danger">
                <CloudOff size={12} strokeWidth={2} /> offline
              </span>
            )}
            {status.online && status.phase === 'syncing' && (
              <span className="text-accent">syncing…</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton label="Insert" onClick={() => setInsertOpen(true)}>
            <Plus size={19} strokeWidth={1.9} />
          </IconButton>
          <IconButton
            label="Calculator"
            active={panel?.kind === 'calculator'}
            onClick={() =>
              setPanel(panel?.kind === 'calculator' ? null : { kind: 'calculator', editing: null })
            }
          >
            <Calculator size={18} strokeWidth={1.8} />
          </IconButton>
        </div>
        <div className="hidden items-center gap-1 sm:flex">
          <IconButton label="Zoom out" onClick={() => engineRef.current?.zoomBy(1 / 1.2)}>
            <Minus size={18} strokeWidth={1.8} />
          </IconButton>
          <button
            type="button"
            onClick={() => engineRef.current?.fitToPage()}
            className="min-w-[52px] rounded-md px-2 py-1 text-[12px] tabular-nums text-ink-soft hover:bg-paper-sunken"
            title="Fit page"
          >
            {Math.round(scale * 100)}%
          </button>
          <IconButton label="Zoom in" onClick={() => engineRef.current?.zoomBy(1.2)}>
            <Plus size={18} strokeWidth={1.8} />
          </IconButton>
        </div>
        <div className="relative">
          <IconButton label="Page menu" onClick={() => setMenuOpen(!menuOpen)} active={menuOpen}>
            <MoreHorizontal size={19} strokeWidth={1.8} />
          </IconButton>
          {menuOpen && (
            <div className="absolute right-0 top-11 z-40 w-52 overflow-hidden rounded-lg border border-line bg-paper-raised shadow-float">
              <button
                type="button"
                className="block w-full px-3 py-2.5 text-left text-[13.5px] hover:bg-paper-sunken"
                onClick={() => {
                  setPaperOpen(true);
                  setMenuOpen(false);
                }}
              >
                Change paper
              </button>
              <button
                type="button"
                className="block w-full px-3 py-2.5 text-left text-[13.5px] hover:bg-paper-sunken"
                onClick={() => {
                  void exportPagePng(page);
                  setMenuOpen(false);
                }}
              >
                Export page as PNG
              </button>
              <button
                type="button"
                className="block w-full px-3 py-2.5 text-left text-[13.5px] hover:bg-paper-sunken"
                onClick={() => {
                  engineRef.current?.fitToPage();
                  setMenuOpen(false);
                }}
              >
                Fit to screen
              </button>
              <button
                type="button"
                className="block w-full border-t border-line px-3 py-2.5 text-left text-[13.5px] text-danger hover:bg-paper-sunken"
                onClick={() => {
                  setDeleteOpen(true);
                  setMenuOpen(false);
                }}
              >
                Delete page
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden">
        <div ref={stageRef} className="canvas-stage absolute inset-0" />

        <RichLayer
          view={view}
          objects={objects}
          interactive={tool === 'select'}
          selected={selected}
          onSelect={(next) => {
            setSelected(next);
            if (next) engineRef.current?.clearSelection();
          }}
          onMove={(kind, id, x, y) => void moveRich(kind, id, x, y)}
          onResize={(kind, id, width, height) => void resizeRich(kind, id, width, height)}
          onOpen={(kind, id) => openObject(kind, id)}
        />

        {selected && (
          <div className="absolute left-1/2 top-2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-line bg-paper-raised/95 px-1.5 py-1 shadow-panel">
            <button
              type="button"
              onClick={() => openObject(selected.kind, selected.id)}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12.5px] text-ink hover:bg-paper-sunken"
            >
              <Pencil size={14} strokeWidth={1.8} /> Edit
            </button>
            <button
              type="button"
              onClick={() => void duplicateRich(selected.kind, selected.id)}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12.5px] text-ink hover:bg-paper-sunken"
            >
              <CopyPlus size={14} strokeWidth={1.8} /> Duplicate
            </button>
            <button
              type="button"
              onClick={() => copyRich(selected.kind, selected.id)}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12.5px] text-ink hover:bg-paper-sunken"
            >
              <Copy size={14} strokeWidth={1.8} /> Copy
            </button>
            <button
              type="button"
              onClick={() => void deleteRich(selected.kind, selected.id)}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12.5px] text-danger hover:bg-paper-sunken"
            >
              <Trash2 size={14} strokeWidth={1.8} /> Delete
            </button>
          </div>
        )}

        {suggestion && (
          <div className="absolute left-1/2 top-2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-paper-raised/95 px-3 py-1.5 shadow-panel">
            <Wand2 size={14} strokeWidth={1.8} className="text-accent-strong" />
            <span className="text-[12.5px] text-ink-soft">Use a clean {suggestion.kind}?</span>
            <button
              type="button"
              onClick={() => {
                engineRef.current?.applyShapeSuggestion(suggestion);
                setSuggestion(null);
              }}
              className="rounded-full bg-accent px-2.5 py-1 text-[12px] text-paper-raised"
            >
              Use shape
            </button>
            <button
              type="button"
              onClick={() => setSuggestion(null)}
              className="rounded-full px-2 py-1 text-[12px] text-ink-muted hover:bg-paper-sunken"
            >
              Keep ink
            </button>
          </div>
        )}



        {textDraft && textScreen && (
          <TextOverlay
            key={`${textDraft.id ?? 'new'}-${textDraft.x}-${textDraft.y}`}
            draft={textDraft}
            left={textScreen.x}
            top={textScreen.y}
            scale={scale}
            onCommit={(text) => {
              engineRef.current?.commitText({ ...textDraft, text });
              setTextDraft(null);
            }}
            onCancel={() => setTextDraft(null)}
          />
        )}

        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleImageFile(file);
            event.target.value = '';
          }}
        />

        <Toolbar
          state={{
            tool,
            settings: toolSettings,
            canUndo: historyState.canUndo,
            canRedo: historyState.canRedo,
            selectionCount,
            hasClipboard,
            collapsed,
            position: toolbarPos,
          }}
          actions={{
            setTool: (next) => setTool(next),
            setSettings: (next) => setToolSettings(next),
            undo: () => void engineRef.current?.undo(),
            redo: () => void engineRef.current?.redo(),
            deleteSelection: () => engineRef.current?.deleteSelection(),
            copySelection: () => setHasClipboard(engineRef.current?.copySelection() ?? false),
            paste: () => {
              engineRef.current?.paste();
              setHasClipboard(false);
            },
            toggleCollapse: () => {
              const next = !collapsed;
              setCollapsed(next);
              persistToolbar({ collapsed: next });
            },
            moveTo: (position) => {
              setToolbarPos(position);
              if (toolbarSaveTimer.current !== null) window.clearTimeout(toolbarSaveTimer.current);
              toolbarSaveTimer.current = window.setTimeout(() => persistToolbar({ position }), 500);
            },
            openSettings: () => navigate('/settings'),
          }}
        />

        <div className="pointer-events-none absolute bottom-[max(1rem,var(--safe-bottom))] right-3 z-20 flex flex-col items-end gap-2">
          <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-line bg-paper-raised/95 px-1 py-1 shadow-panel">
            <IconButton
              label="Previous page"
              className="h-8 w-8"
              disabled={!prevPage}
              onClick={() => prevPage && navigate(`/page/${prevPage.id}`)}
            >
              <ChevronLeft size={17} strokeWidth={1.9} />
            </IconButton>
            <span className="min-w-[34px] text-center text-[12px] tabular-nums text-ink-soft">
              {index >= 0 ? index + 1 : 1}/{pages?.length ?? 1}
            </span>
            <IconButton
              label="Next page"
              className="h-8 w-8"
              disabled={!nextPage}
              onClick={() => nextPage && navigate(`/page/${nextPage.id}`)}
            >
              <ChevronRight size={17} strokeWidth={1.9} />
            </IconButton>
          </div>
        </div>

        {toast && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-40 -translate-x-1/2 rounded-lg bg-ink/90 px-3 py-2 text-[12.5px] text-paper-raised shadow-float">
            {toast}
          </div>
        )}

        {panel?.kind === 'equation' && (
          <div className="absolute inset-x-0 bottom-0 z-40">
            <EquationPanel
              key={panel.editing?.id ?? panel.prefill ?? 'new-equation'}
              initial={(panel.editing as EquationPlacement | null) ?? null}
              initialLatex={panel.prefill}
              onCommit={(draft) => {
                if (panel.editing) void updateRich('equation', panel.editing.id, draft);
                else void insertEquation(draft);
              }}
              onClose={() => setPanel(null)}
            />
          </div>
        )}

        {panel?.kind === 'graph' && (
          <GraphPanel
            key={panel.editing?.id ?? 'new-graph'}
            initial={(panel.editing as GraphObject | null) ?? null}
            onCommit={(draft) => {
              if (panel.editing) void updateRich('graph', panel.editing.id, draft);
              else void insertGraph(draft);
            }}
            onClose={() => setPanel(null)}
          />
        )}

        {panel?.kind === 'table' && (
          <TablePanel
            key={panel.editing?.id ?? 'new-table'}
            initial={(panel.editing as TableObject | null) ?? null}
            onCommit={(draft) => {
              if (panel.editing) void updateRich('table', panel.editing.id, draft);
              else void insertTable(draft);
            }}
            onClose={() => setPanel(null)}
          />
        )}

        {panel?.kind === 'calculator' && (
          <CalculatorPanel
            onInsertText={insertTextAtCentre}
            onInsertEquation={(latex) => setPanel({ kind: 'equation', editing: null, prefill: latex })}
            onClose={() => setPanel(null)}
          />
        )}
      </div>

      <InsertSheet open={insertOpen} onClose={() => setInsertOpen(false)} onInsert={handleInsertRequest} />

      <Modal
        open={paperOpen}
        title="Change paper"
        description="Strokes, text and images are untouched."
        onClose={() => setPaperOpen(false)}
        footer={
          <button
            type="button"
            className="rounded-lg bg-accent px-3 py-2 text-[13px] text-paper-raised"
            onClick={() => setPaperOpen(false)}
          >
            Done
          </button>
        }
      >
        <PaperPicker
          value={page.template}
          onChange={async (template) => {
            await touch({ ...page, template });
            await markOutbox('page', page.id);
            setChangeTick((tick) => tick + 1);
          }}
        />
      </Modal>

      <Modal
        open={deleteOpen}
        title="Delete page"
        description="The page and its ink are tombstoned locally and on Windows on the next sync."
        onClose={() => setDeleteOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-[13px] text-ink-soft"
              onClick={() => setDeleteOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-lg bg-danger px-3 py-2 text-[13px] text-white"
              onClick={async () => {
                await deletePage(page.id);
                navigate(`/notebook/${page.notebookId}`);
              }}
            >
              Delete page
            </button>
          </>
        }
      />
    </div>
  );
}

function PaperPicker({
  value,
  onChange,
}: {
  value: Page['template'];
  onChange: (template: Page['template']) => void;
}) {
  const options: { value: Page['template']; label: string }[] = [
    { value: 'blank', label: 'Blank' },
    { value: 'ruled', label: 'Ruled' },
    { value: 'grid', label: 'Grid' },
    { value: 'dots', label: 'Dotted' },
    { value: 'graph', label: 'Graph' },
    { value: 'isometric', label: 'Isometric' },
    { value: 'engineering', label: 'Engineering' },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cx(
            'rounded-lg border px-2 py-3 text-[13px]',
            value === option.value
              ? 'border-accent bg-accent-soft text-accent-strong'
              : 'border-line bg-paper-raised text-ink-soft',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function TextOverlay({
  draft,
  left,
  top,
  scale,
  onCommit,
  onCancel,
}: {
  draft: TextDraft;
  left: number;
  top: number;
  scale: number;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(draft.text);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const length = ref.current?.value.length ?? 0;
    ref.current?.setSelectionRange(length, length);
  }, []);

  const fontSize = Math.max(13, draft.fontSize * scale);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          onCommit(value);
        }
      }}
      style={{
        left,
        top,
        width: Math.max(120, draft.width * scale),
        minHeight: fontSize * 1.6,
        fontSize,
        lineHeight: 1.35,
        color: draft.color,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
      className="absolute z-40 resize rounded border border-accent/50 bg-paper-raised/95 p-1 shadow-panel outline-none"
      placeholder="Type…"
      aria-label="Text block"
    />
  );
}
