import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Archive,
  BookOpen,
  Cloud,
  Download,
  FolderPlus,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Star,
} from 'lucide-react';
import { db } from '../storage/db';
import type { Notebook, PageSize, PaperTemplate } from '../storage/types';
import { PAGE_SIZES } from '../storage/types';
import {
  createFolder,
  createNotebook,
  deleteNotebook,
  duplicateNotebook,
  softDeleteEntity,
  updateFolder,
  updateNotebook,
} from '../storage/repo';
import { relativeTime, plural } from '../lib/format';
import { navigate } from '../app/router';
import { Button, EmptyState, Field, IconButton, Modal, ScreenHeader, TextInput, cx } from './ui';

const COVER_COLORS = ['#4a6156', '#5b5646', '#7d5a4a', '#465a72', '#6a4a62', '#3c4b4f'];

type LibraryView = 'all' | 'favorites' | 'archived';

export function LibraryScreen({ folderId }: { folderId?: string }) {
  const notebooks = useLiveQuery(() => db.notebooks.toArray(), []);
  const folders = useLiveQuery(() => db.folders.toArray(), []);
  const pages = useLiveQuery(() => db.pages.toArray(), []);
  const thumbnails = useLiveQuery(() => db.thumbnails.toArray(), []);

  const [view, setView] = useState<LibraryView>('all');
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Notebook | null>(null);
  const [renameFolderTarget, setRenameFolderTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Notebook | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [template, setTemplate] = useState<PaperTemplate>('ruled');
  const [size, setSize] = useState<PageSize>('a4');
  const [cover, setCover] = useState(COVER_COLORS[0]!);
  const [folderName, setFolderName] = useState('');
  const [busy, setBusy] = useState(false);

  const activeFolders = useMemo(() => (folders ?? []).filter((f) => f.deletedAt === null), [folders]);
  const pageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const page of pages ?? []) {
      if (page.deletedAt !== null) continue;
      counts.set(page.notebookId, (counts.get(page.notebookId) ?? 0) + 1);
    }
    return counts;
  }, [pages]);
  const thumbByPage = useMemo(() => {
    const map = new Map<string, string>();
    for (const thumb of thumbnails ?? []) map.set(thumb.pageId, thumb.dataUrl);
    return map;
  }, [thumbnails]);
  const firstPageByNotebook = useMemo(() => {
    const map = new Map<string, string>();
    const sorted = [...(pages ?? [])]
      .filter((p) => p.deletedAt === null)
      .sort((a, b) => a.index - b.index);
    for (const page of sorted) {
      if (!map.has(page.notebookId)) map.set(page.notebookId, page.id);
    }
    return map;
  }, [pages]);

  const currentFolder = folderId ? activeFolders.find((f) => f.id === folderId) : undefined;

  const visible = useMemo(() => {
    const list = (notebooks ?? []).filter((n) => n.deletedAt === null);
    const search = query.trim().toLowerCase();
    return list
      .filter((notebook) => {
        if (view === 'favorites') return notebook.favorite;
        if (view === 'archived') return notebook.archived;
        return !notebook.archived;
      })
      .filter((notebook) => {
        if (!folderId) return true;
        return notebook.folderId === folderId;
      })
      .filter((notebook) => (search ? notebook.title.toLowerCase().includes(search) : true))
      .sort((a, b) => {
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      });
  }, [notebooks, query, view, folderId]);

  const childFolders = useMemo(
    () => activeFolders.filter((f) => (folderId ? f.parentId === folderId : true)),
    [activeFolders, folderId],
  );

  async function handleCreate(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const notebook = await createNotebook({
        title: title || 'Untitled notebook',
        folderId: folderId ?? null,
        coverColor: cover,
        template,
        size,
      });
      setCreateOpen(false);
      setTitle('');
      navigate(`/notebook/${notebook.id}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateFolder(): Promise<void> {
    const name = folderName.trim();
    if (!name) return;
    await createFolder(name, folderId ?? null);
    setFolderName('');
    setFolderOpen(false);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ScreenHeader
        title={currentFolder?.name ?? 'Library'}
        subtitle={`${plural(visible.length, 'notebook')} · ${plural(activeFolders.length, 'folder')}`}
        onBack={folderId ? () => navigate('/') : undefined}
        actions={
          <>
            <IconButton label="Synchronisation" onClick={() => navigate('/sync')}>
              <Cloud size={19} strokeWidth={1.7} />
            </IconButton>
            <IconButton label="Backup and restore" onClick={() => navigate('/backup')}>
              <Download size={19} strokeWidth={1.7} />
            </IconButton>
            <IconButton label="Settings" onClick={() => navigate('/settings')}>
              <Settings size={19} strokeWidth={1.7} />
            </IconButton>
          </>
        }
      />

      <div className="scroll-pane thin-scroll safe-px mx-auto w-full max-w-6xl min-h-0 flex-1 pb-[max(2rem,var(--safe-bottom))] pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search
              size={16}
              strokeWidth={1.8}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search notebooks"
              className="h-10 w-full rounded-lg border border-line bg-paper-raised pl-9 pr-3 text-[14px] outline-none placeholder:text-ink-faint focus:border-accent"
            />
          </div>
          <div className="flex rounded-lg border border-line bg-paper-sunken p-0.5">
            {(
              [
                { key: 'all', label: 'All', icon: BookOpen },
                { key: 'favorites', label: 'Favourites', icon: Star },
                { key: 'archived', label: 'Archived', icon: Archive },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setView(item.key)}
                className={cx(
                  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px]',
                  view === item.key ? 'bg-paper-raised text-ink shadow-sm' : 'text-ink-muted',
                )}
              >
                <item.icon size={14} strokeWidth={1.8} />
                <span className="hidden sm:inline">{item.label}</span>
              </button>
            ))}
          </div>
          <Button
            variant="secondary"
            onClick={() => setFolderOpen(true)}
            icon={<FolderPlus size={16} strokeWidth={1.8} />}
          >
            Folder
          </Button>
          <Button
            variant="primary"
            onClick={() => setCreateOpen(true)}
            icon={<Plus size={17} strokeWidth={2} />}
          >
            Notebook
          </Button>
        </div>

        {view === 'all' && childFolders.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {childFolders.map((folder) => {
              const count = (notebooks ?? []).filter(
                (n) => n.deletedAt === null && n.folderId === folder.id,
              ).length;
              return (
                <div
                  key={folder.id}
                  className="group flex items-center rounded-lg border border-line bg-paper-raised"
                >
                  <button
                    type="button"
                    onClick={() => navigate(`/folder/${folder.id}`)}
                    className="flex items-center gap-2 px-3 py-2 text-[13.5px] text-ink"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: folder.color }} />
                    {folder.name}
                    <span className="text-ink-faint">{count}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Rename ${folder.name}`}
                    className="mr-1.5 rounded p-1 text-ink-faint hover:bg-paper-sunken"
                    onClick={() => setRenameFolderTarget({ id: folder.id, name: folder.name })}
                  >
                    <MoreHorizontal size={15} strokeWidth={1.8} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-5">
          {visible.length === 0 ? (
            <EmptyState
              title={view === 'archived' ? 'Nothing archived' : 'No notebooks yet'}
              body={
                view === 'archived'
                  ? 'Archived notebooks stay on this iPad and on your Windows laptop; nothing is deleted.'
                  : 'Create a notebook and start writing with Apple Pencil. Everything is stored locally and works without a network.'
              }
              action={
                view !== 'archived' ? (
                  <Button variant="primary" onClick={() => setCreateOpen(true)}>
                    New notebook
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {visible.map((notebook) => {
                const pageId = firstPageByNotebook.get(notebook.id);
                const thumb = pageId ? thumbByPage.get(pageId) : undefined;
                return (
                  <div key={notebook.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => navigate(`/notebook/${notebook.id}`)}
                      className="block w-full text-left"
                    >
                      <div
                        className="relative aspect-[3/4] overflow-hidden rounded-lg border border-line bg-paper-raised shadow-panel"
                        style={{ borderTopColor: notebook.coverColor }}
                      >
                        {thumb ? (
                          <img src={thumb} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div
                            className="flex h-full w-full flex-col justify-between p-3"
                            style={{ background: `linear-gradient(180deg, ${notebook.coverColor}0f, #fffdfa)` }}
                          >
                            <div className="h-1 w-8 rounded-full" style={{ background: notebook.coverColor }} />
                            <div className="font-serif text-[15px] leading-snug text-ink-soft">
                              {notebook.title}
                            </div>
                          </div>
                        )}
                        <span
                          className="absolute inset-x-0 top-0 h-1"
                          style={{ background: notebook.coverColor }}
                        />
                        {notebook.favorite && (
                          <span className="absolute right-2 top-2 rounded-full bg-paper-raised/90 p-1 text-accent">
                            <Star size={13} strokeWidth={2} fill="currentColor" />
                          </span>
                        )}
                      </div>
                      <div className="mt-2 px-0.5">
                        <div className="truncate text-[14px] font-medium text-ink">{notebook.title}</div>
                        <div className="mt-0.5 text-[12px] text-ink-muted">
                          {plural(pageCounts.get(notebook.id) ?? 0, 'page')} · {relativeTime(notebook.updatedAt)}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-label={`Actions for ${notebook.title}`}
                      onClick={() => setMenuId(menuId === notebook.id ? null : notebook.id)}
                      className="absolute right-2 top-9 rounded-md bg-paper-raised/95 p-1.5 text-ink-soft opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus:opacity-100 aria-expanded:opacity-100"
                    >
                      <MoreHorizontal size={16} strokeWidth={1.9} />
                    </button>
                    {menuId === notebook.id && (
                      <div className="absolute right-1 top-16 z-20 w-44 overflow-hidden rounded-lg border border-line bg-paper-raised shadow-float">
                        {[
                          {
                            label: 'Rename',
                            run: () => {
                              setRenameTarget(notebook);
                              setTitle(notebook.title);
                            },
                          },
                          { label: 'Duplicate', run: () => void duplicateNotebook(notebook.id) },
                          {
                            label: notebook.favorite ? 'Unfavourite' : 'Favourite',
                            run: () => void updateNotebook(notebook.id, { favorite: !notebook.favorite }),
                          },
                          {
                            label: notebook.archived ? 'Unarchive' : 'Archive',
                            run: () => void updateNotebook(notebook.id, { archived: !notebook.archived }),
                          },
                          { label: 'Delete', run: () => setDeleteTarget(notebook), danger: true },
                        ].map((item) => (
                          <button
                            key={item.label}
                            type="button"
                            onClick={() => {
                              item.run();
                              setMenuId(null);
                            }}
                            className={cx(
                              'block w-full px-3 py-2.5 text-left text-[13.5px] hover:bg-paper-sunken',
                              item.danger ? 'text-danger' : 'text-ink',
                            )}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Modal
        open={createOpen}
        title="New notebook"
        description="Choose the paper that fits the work; you can change it later."
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void handleCreate()} disabled={busy}>
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Title">
            <TextInput
              value={title}
              autoFocus
              placeholder="Untitled notebook"
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field label="Paper">
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ['blank', 'Blank'],
                  ['ruled', 'Ruled'],
                  ['grid', 'Grid'],
                  ['dots', 'Dotted'],
                  ['graph', 'Graph'],
                  ['isometric', 'Isometric'],
                  ['engineering', 'Engineering'],
                ] as [PaperTemplate, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTemplate(value)}
                  className={cx(
                    'rounded-lg border px-2 py-2 text-[13px]',
                    template === value
                      ? 'border-accent bg-accent-soft text-accent-strong'
                      : 'border-line bg-paper-raised text-ink-soft',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Page size">
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
          <Field label="Cover">
            <div className="flex gap-2">
              {COVER_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Cover colour ${color}`}
                  onClick={() => setCover(color)}
                  className={cx(
                    'h-8 w-8 rounded-full border-2',
                    cover === color ? 'border-ink' : 'border-transparent',
                  )}
                  style={{ background: color }}
                />
              ))}
            </div>
          </Field>
        </div>
      </Modal>

      <Modal
        open={folderOpen}
        title="New folder"
        onClose={() => setFolderOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFolderOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void handleCreateFolder()}>
              Create folder
            </Button>
          </>
        }
      >
        <Field label="Name">
          <TextInput
            value={folderName}
            autoFocus
            placeholder="Semester notes"
            onChange={(event) => setFolderName(event.target.value)}
          />
        </Field>
      </Modal>

      <Modal
        open={renameTarget !== null}
        title="Rename notebook"
        onClose={() => setRenameTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (renameTarget) void updateNotebook(renameTarget.id, { title: title.trim() || 'Untitled notebook' });
                setRenameTarget(null);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Field label="Title">
          <TextInput value={title} autoFocus onChange={(event) => setTitle(event.target.value)} />
        </Field>
      </Modal>

      <Modal
        open={renameFolderTarget !== null}
        title="Folder"
        onClose={() => setRenameFolderTarget(null)}
        footer={
          <>
            <Button
              variant="ghost"
              className="text-danger"
              onClick={() => {
                if (renameFolderTarget) void softDeleteEntity('folder', renameFolderTarget.id, true);
                setRenameFolderTarget(null);
              }}
            >
              Delete folder
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (renameFolderTarget && folderName.trim()) {
                  void updateFolder(renameFolderTarget.id, { name: folderName.trim() });
                }
                setRenameFolderTarget(null);
                setFolderName('');
              }}
            >
              Save
            </Button>
          </>
        }
        description="Deleting a folder archives its notebooks; nothing is erased permanently."
      >
        <Field label="Name">
          <TextInput
            value={folderName || renameFolderTarget?.name || ''}
            autoFocus
            onChange={(event) => setFolderName(event.target.value)}
          />
        </Field>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        title="Delete notebook"
        description="The notebook is marked as deleted and the tombstone syncs to Windows. Restore it from a backup if needed."
        onClose={() => setDeleteTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (deleteTarget) void deleteNotebook(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              Delete
            </Button>
          </>
        }
      />
    </div>
  );
}
