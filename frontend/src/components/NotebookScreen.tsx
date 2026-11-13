import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  FileDown,
  FilePlus2,
  Grid2x2,
  MoreHorizontal,
  Plus,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import { db } from '../storage/db';
import type { PageSize, PaperTemplate } from '../storage/types';
import { PAGE_SIZES } from '../storage/types';
import {
  activePages,
  createPage,
  deletePage,
  duplicatePage,
  softDeleteEntity,
  touch,
  updateNotebook,
} from '../storage/repo';
import { navigate } from '../app/router';
import { relativeTime, plural } from '../lib/format';
import { attachPdfAsPages, exportNotebookPdf } from '../export/exporters';
import { Button, EmptyState, Field, IconButton, Modal, ScreenHeader, Spinner, TextInput, cx } from './ui';

const TEMPLATES: { value: PaperTemplate; label: string }[] = [
  { value: 'blank', label: 'Blank' },
  { value: 'ruled', label: 'Ruled' },
  { value: 'grid', label: 'Grid' },
  { value: 'dots', label: 'Dotted' },
  { value: 'graph', label: 'Graph' },
  { value: 'isometric', label: 'Isometric' },
  { value: 'engineering', label: 'Engineering' },
];

export function NotebookScreen({ notebookId }: { notebookId: string }) {
  const notebook = useLiveQuery(() => db.notebooks.get(notebookId), [notebookId]);
  const pages = useLiveQuery(() => activePages(notebookId), [notebookId]);
  const thumbnails = useLiveQuery(() => db.thumbnails.toArray(), []);
  const pdfInput = useRef<HTMLInputElement>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [template, setTemplate] = useState<PaperTemplate>('ruled');
  const [size, setSize] = useState<PageSize>('a4');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [deletePageId, setDeletePageId] = useState<string | null>(null);
  const [deleteNotebookOpen, setDeleteNotebookOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [paperTarget, setPaperTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const thumbByPage = useMemo(() => {
    const map = new Map<string, string>();
    for (const thumb of thumbnails ?? []) map.set(thumb.pageId, thumb.dataUrl);
    return map;
  }, [thumbnails]);

  if (!notebook) {
    return (
      <div className="safe-px pt-16">
        <EmptyState title="Notebook unavailable" body="It may have been deleted on another device." />
        <div className="mt-4 text-center">
          <Button onClick={() => navigate('/')}>Back to library</Button>
        </div>
      </div>
    );
  }

  const list = pages ?? [];

  async function addPage(): Promise<void> {
    setBusy('add');
    try {
      const page = await createPage(notebookId, { template, size, index: list.length });
      setAddOpen(false);
      navigate(`/page/${page.id}`);
    } finally {
      setBusy(null);
    }
  }

  async function importPdf(file: File): Promise<void> {
    setBusy('pdf');
    setError(null);
    try {
      const result = await attachPdfAsPages(notebookId, file);
      const all = await activePages(notebookId);
      const first = all.find((p) => p.pdfAssetId === result.assetId);
      if (first) navigate(`/page/${first.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF import failed');
    } finally {
      setBusy(null);
      if (pdfInput.current) pdfInput.current.value = '';
    }
  }

  async function exportPdf(): Promise<void> {
    setBusy('export');
    setError(null);
    try {
      await exportNotebookPdf(notebookId, notebook!.title, undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF export failed');
    } finally {
      setBusy(null);
    }
  }

  async function movePage(pageId: string, direction: -1 | 1): Promise<void> {
    const index = list.findIndex((p) => p.id === pageId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= list.length) return;
    const a = list[index]!;
    const b = list[target]!;
    await touch({ ...a, index: b.index });
    await touch({ ...b, index: a.index });
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ScreenHeader
        title={notebook.title}
        subtitle={`${plural(list.length, 'page')} · edited ${relativeTime(notebook.updatedAt)}`}
        onBack={() => navigate('/')}
        actions={
          <>
            <IconButton
              label={notebook.favorite ? 'Remove favourite' : 'Add to favourites'}
              onClick={() => void updateNotebook(notebookId, { favorite: !notebook.favorite })}
              active={notebook.favorite}
            >
              <Star size={18} strokeWidth={1.8} fill={notebook.favorite ? 'currentColor' : 'none'} />
            </IconButton>
            <IconButton label="Rename notebook" onClick={() => { setTitle(notebook.title); setRenameOpen(true); }}>
              <Grid2x2 size={18} strokeWidth={1.7} />
            </IconButton>
            <IconButton label="Delete notebook" onClick={() => setDeleteNotebookOpen(true)}>
              <Trash2 size={18} strokeWidth={1.7} />
            </IconButton>
          </>
        }
      />

      <div className="scroll-pane thin-scroll safe-px mx-auto w-full max-w-6xl min-h-0 flex-1 pb-[max(2rem,var(--safe-bottom))] pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            icon={<Plus size={17} strokeWidth={2} />}
            onClick={() => setAddOpen(true)}
          >
            Add page
          </Button>
          <Button
            variant="secondary"
            icon={<Upload size={16} strokeWidth={1.8} />}
            onClick={() => pdfInput.current?.click()}
            disabled={busy === 'pdf'}
          >
            {busy === 'pdf' ? 'Importing PDF…' : 'Import PDF'}
          </Button>
          <Button
            variant="secondary"
            icon={<FileDown size={16} strokeWidth={1.8} />}
            onClick={() => void exportPdf()}
            disabled={busy === 'export' || list.length === 0}
          >
            {busy === 'export' ? 'Exporting…' : 'Export PDF'}
          </Button>
          <Button
            variant="ghost"
            icon={<Copy size={16} strokeWidth={1.8} />}
            onClick={() => {
              setTitle(notebook.title);
              setRenameOpen(true);
            }}
          >
            Notebook settings
          </Button>
          <input
            ref={pdfInput}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importPdf(file);
            }}
          />
          {busy === 'export' && <Spinner />}
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger">
            {error}
          </div>
        )}

        <div className="mt-5">
          {list.length === 0 ? (
            <EmptyState
              title="No pages yet"
              body="Add a page and start writing with Apple Pencil. Paper can be changed at any time without touching your ink."
              action={<Button variant="primary" onClick={() => setAddOpen(true)}>Add page</Button>}
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {list.map((page, index) => (
                <div key={page.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => navigate(`/page/${page.id}`)}
                    className="block w-full text-left"
                  >
                    <div className="aspect-[3/4] overflow-hidden rounded-lg border border-line bg-paper-raised shadow-panel">
                      {thumbByPage.get(page.id) ? (
                        <img src={thumbByPage.get(page.id)} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-paper-sunken text-[12px] text-ink-faint">
                          {page.pdfAssetId ? 'PDF page' : page.template}
                        </div>
                      )}
                    </div>
                    <div className="mt-2 flex items-center justify-between px-0.5">
                      <span className="text-[13px] text-ink-soft">
                        {index + 1}
                        {page.title ? ` · ${page.title}` : ''}
                      </span>
                      <span className="text-[11.5px] uppercase tracking-wide text-ink-faint">
                        {page.pdfAssetId ? 'PDF' : PAGE_SIZES[page.size].label}
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    aria-label={`Page ${index + 1} actions`}
                    onClick={() => setMenuId(menuId === page.id ? null : page.id)}
                    className="absolute right-2 top-2 rounded-md bg-paper-raised/95 p-1.5 text-ink-soft opacity-0 shadow-sm group-hover:opacity-100 focus:opacity-100"
                  >
                    <MoreHorizontal size={16} strokeWidth={1.9} />
                  </button>
                  {menuId === page.id && (
                    <div className="absolute right-1 top-10 z-20 w-48 overflow-hidden rounded-lg border border-line bg-paper-raised shadow-float">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] hover:bg-paper-sunken"
                        onClick={() => {
                          void duplicatePage(page.id);
                          setMenuId(null);
                        }}
                      >
                        <Copy size={14} strokeWidth={1.8} /> Duplicate
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] hover:bg-paper-sunken"
                        onClick={() => {
                          setPaperTarget(page.id);
                          setTemplate(page.template);
                          setMenuId(null);
                        }}
                      >
                        <FilePlus2 size={14} strokeWidth={1.8} /> Change paper
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] hover:bg-paper-sunken disabled:opacity-40"
                        disabled={index === 0}
                        onClick={() => {
                          void movePage(page.id, -1);
                          setMenuId(null);
                        }}
                      >
                        <ArrowLeft size={14} strokeWidth={1.8} /> Move earlier
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] hover:bg-paper-sunken disabled:opacity-40"
                        disabled={index === list.length - 1}
                        onClick={() => {
                          void movePage(page.id, 1);
                          setMenuId(null);
                        }}
                      >
                        <ArrowRight size={14} strokeWidth={1.8} /> Move later
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-left text-[13px] text-danger hover:bg-paper-sunken"
                        onClick={() => {
                          setDeletePageId(page.id);
                          setMenuId(null);
                        }}
                      >
                        <Trash2 size={14} strokeWidth={1.8} /> Delete page
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Modal
        open={addOpen}
        title="Add page"
        onClose={() => setAddOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void addPage()} disabled={busy === 'add'}>
              Add page
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Paper">
            <div className="grid grid-cols-3 gap-2">
              {TEMPLATES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setTemplate(item.value)}
                  className={cx(
                    'rounded-lg border px-2 py-2 text-[13px]',
                    template === item.value
                      ? 'border-accent bg-accent-soft text-accent-strong'
                      : 'border-line bg-paper-raised text-ink-soft',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Size">
            <div className="grid grid-cols-3 gap-2">
              {(['a4', 'letter', 'infinite'] as PageSize[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSize(value)}
                  className={cx(
                    'rounded-lg border px-2 py-2 text-[13px]',
                    size === value
                      ? 'border-accent bg-accent-soft text-accent-strong'
                      : 'border-line bg-paper-raised text-ink-soft',
                  )}
                >
                  {PAGE_SIZES[value].label}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </Modal>

      <Modal
        open={paperTarget !== null}
        title="Change paper"
        description="Ink, text and images stay exactly as they are."
        onClose={() => setPaperTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPaperTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                const page = list.find((p) => p.id === paperTarget);
                if (page) await touch({ ...page, template });
                setPaperTarget(null);
              }}
            >
              Apply
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-3 gap-2">
          {TEMPLATES.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setTemplate(item.value)}
              className={cx(
                'rounded-lg border px-2 py-3 text-[13px]',
                template === item.value
                  ? 'border-accent bg-accent-soft text-accent-strong'
                  : 'border-line bg-paper-raised text-ink-soft',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </Modal>

      <Modal
        open={renameOpen}
        title="Notebook"
        onClose={() => setRenameOpen(false)}
        footer={
          <>
            <Button
              variant="ghost"
              className="text-danger"
              onClick={() => {
                setRenameOpen(false);
                setDeleteNotebookOpen(true);
              }}
            >
              Delete
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                await updateNotebook(notebookId, { title: title.trim() || 'Untitled notebook' });
                setRenameOpen(false);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Field label="Title">
          <TextInput value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
        </Field>
        <div className="mt-4">
          <Field label="Archive">
            <Button
              variant="secondary"
              onClick={() => void updateNotebook(notebookId, { archived: !notebook.archived })}
            >
              {notebook.archived ? 'Move out of archive' : 'Archive notebook'}
            </Button>
          </Field>
        </div>
      </Modal>

      <Modal
        open={deletePageId !== null}
        title="Delete page"
        description="The page and its strokes are kept as a tombstone so the deletion also reaches Windows."
        onClose={() => setDeletePageId(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeletePageId(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (deletePageId) await deletePage(deletePageId);
                setDeletePageId(null);
              }}
            >
              Delete page
            </Button>
          </>
        }
      />

      <Modal
        open={deleteNotebookOpen}
        title="Delete notebook"
        description="All pages are marked deleted and will be removed from the Windows copy on the next sync."
        onClose={() => setDeleteNotebookOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteNotebookOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await softDeleteEntity('notebook', notebookId, true);
                navigate('/');
              }}
            >
              Delete notebook
            </Button>
          </>
        }
      />
    </div>
  );
}
