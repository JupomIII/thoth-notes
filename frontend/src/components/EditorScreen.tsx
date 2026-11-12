import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  Minus,
  MoreHorizontal,
  Plus,
} from 'lucide-react';
import { db } from '../storage/db';
import type { DrawToolId, Page, ToolSettings } from '../storage/types';
import { DEFAULT_TOOL_SETTINGS } from '../storage/types';
import {
  activePages,
  deletePage,
  getSettings,
  loadPageContent,
  markOutbox,
  saveSettings,
  touch,
} from '../storage/repo';
import { PageWriteBuffer, createPagePersistence } from '../storage/pageStore';
import { DrawingEngine, type PageContent, type TextDraft } from '../drawing/engine';
import { renderPage } from '../drawing/renderPage';
import { loadPdf, renderPdfPage, type PDFDocumentProxy } from '../pdf/loader';
import { saveImageAsset } from '../storage/assets';
import { exportPagePng } from '../export/exporters';
import { navigate } from '../app/router';
import { syncStatus } from '../sync/store';
import { IconButton, Modal, cx } from './ui';
import { Toolbar } from './Toolbar';

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
          if (viewTimer.current !== null) window.clearTimeout(viewTimer.current);
          viewTimer.current = window.setTimeout(() => {
            setPdfScale(Math.round(view.scale * 2) / 2);
          }, 220);
        },
        requestTextEdit: (draft) => setTextDraft(draft),
        requestImage: () => imageInputRef.current?.click(),
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
  }, [changeTick, page?.id, page?.pdfAssetId, page?.pdfPageIndex, page?.width, page?.size, page?.backgroundTint]);

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
        return;
      }
      if (mod && event.key.toLowerCase() === 'v') {
        if (engine.paste()) setHasClipboard(false);
        return;
      }
      if (mod && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        engine.selectAll();
        return;
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        if (engine.selectionCount() > 0) {
          event.preventDefault();
          engine.deleteSelection();
        }
        return;
      }
      if (event.key === 'Escape') {
        engine.clearSelection();
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
      </div>

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
