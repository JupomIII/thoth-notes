import { useEffect, useRef, useState } from 'react';
import { DatabaseBackup, Download, FileArchive, HardDrive, Upload } from 'lucide-react';
import { exportLocalBackup, importLocalBackup } from '../storage/backup';
import { loadSyncConfig, saveSyncConfig, syncNow } from '../sync/engine';
import { SyncClient } from '../sync/client';
import type { BackupInfo } from '../sync/protocol';
import { downloadBlob, formatBytes } from '../lib/download';
import { relativeTime } from '../lib/format';
import { navigate } from '../app/router';
import { Button, Field, ScreenHeader, Spinner, TextInput, cx } from './ui';

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function BackupScreen() {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [serverUrl, setServerUrl] = useState('');
  const [token, setToken] = useState('');
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      const config = await loadSyncConfig();
      setServerUrl(config.serverUrl);
      setToken(config.token);
      if (config.serverUrl && config.token) {
        try {
          setBackups(await new SyncClient(config.serverUrl, config.token, '').listBackups());
        } catch {
          setBackups([]);
        }
      }
    })();
  }, []);

  async function handleLocalExport(): Promise<void> {
    setBusy('export');
    setMessage(null);
    try {
      const result = await exportLocalBackup();
      downloadBlob(result.blob, `thoth-notes-${stamp()}.zip`);
      setMessage({
        tone: 'ok',
        text: `Exported ${result.counts.notebook ?? 0} notebooks, ${result.counts.page ?? 0} pages, ${result.counts.stroke ?? 0} strokes (${formatBytes(result.bytes)}).`,
      });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Export failed' });
    } finally {
      setBusy(null);
    }
  }

  async function handleImport(file: File): Promise<void> {
    setBusy('import');
    setMessage(null);
    try {
      const result = await importLocalBackup(file);
      setMessage({
        tone: result.ok ? 'ok' : 'error',
        text: result.ok
          ? `Restored: ${result.inserted} new, ${result.updated} updated, ${result.skipped} already present, ${result.assets} attachments.`
          : `Backup rejected: ${result.errors.join('; ')}`,
      });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Import failed' });
    } finally {
      setBusy(null);
      setImportOpen(false);
      if (importRef.current) importRef.current.value = '';
    }
  }

  async function handleServer(action: 'create' | 'refresh'): Promise<void> {
    setBusy(action);
    setMessage(null);
    try {
      const config = await saveSyncConfig({ serverUrl, token });
      const client = new SyncClient(config.serverUrl, config.token, '');
      if (action === 'create') {
        const info = await client.createBackup();
        setMessage({ tone: 'ok', text: `Windows backup created: ${info.name}` });
      }
      setBackups(await client.listBackups());
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Windows backup failed' });
    } finally {
      setBusy(null);
    }
  }

  async function handleDownload(name: string): Promise<void> {
    setBusy(name);
    setMessage(null);
    try {
      const config = await loadSyncConfig();
      const client = new SyncClient(config.serverUrl, config.token, '');
      downloadBlob(await client.downloadBackup(name), name);
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Download failed' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ScreenHeader
        title="Backup and restore"
        subtitle="The laptop is the archive; this iPad stays independently usable"
        onBack={() => navigate('/')}
      />

      <div className="scroll-pane thin-scroll safe-px mx-auto w-full max-w-3xl min-h-0 flex-1 space-y-4 pb-[max(2rem,var(--safe-bottom))] pt-5">
        {message && (
          <div
            className={cx(
              'rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed',
              message.tone === 'ok' ? 'border-accent/30 bg-accent-soft text-accent-strong' : 'border-danger/30 bg-danger/5 text-danger',
            )}
          >
            {message.text}
          </div>
        )}

        <section className="rounded-xl border border-line bg-paper-raised p-4">
          <h2 className="flex items-center gap-2 font-serif text-[17px] text-ink">
            <HardDrive size={17} strokeWidth={1.8} /> This iPad
          </h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
            A ZIP archive with JSON metadata, vector strokes, images and original PDFs, plus a manifest with SHA-256
            checksums. Keep a copy outside the iPad in case Safari storage is cleared.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="primary"
              icon={<Download size={16} strokeWidth={1.8} />}
              onClick={() => void handleLocalExport()}
              disabled={busy === 'export'}
            >
              {busy === 'export' ? 'Preparing…' : 'Export local backup'}
            </Button>
            <Button
              variant="secondary"
              icon={<Upload size={16} strokeWidth={1.8} />}
              onClick={() => importRef.current?.click()}
              disabled={busy === 'import'}
            >
              {busy === 'import' ? 'Restoring…' : 'Restore from ZIP'}
            </Button>
            <input
              ref={importRef}
              type="file"
              accept="application/zip,.zip"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleImport(file);
              }}
            />
          </div>
        </section>

        <section className="rounded-xl border border-line bg-paper-raised p-4">
          <h2 className="flex items-center gap-2 font-serif text-[17px] text-ink">
            <DatabaseBackup size={17} strokeWidth={1.8} /> Windows archive
          </h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
            The server keeps rotating archives in <code className="rounded bg-paper-sunken px-1">backend\storage\backups</code>.
            Rotation keeps the newest seven by default.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Server address">
              <TextInput
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                placeholder="https://192.168.1.20:8443"
                inputMode="url"
                autoCapitalize="off"
              />
            </Field>
            <Field label="Pairing token">
              <TextInput
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Token from the server"
                autoCapitalize="off"
                className="font-mono text-[13px]"
              />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon={<FileArchive size={16} strokeWidth={1.8} />}
              onClick={() => void handleServer('create')}
              disabled={busy === 'create' || !serverUrl || !token}
            >
              {busy === 'create' ? <Spinner /> : null}
              Create backup on Windows
            </Button>
            <Button
              variant="ghost"
              onClick={() => void handleServer('refresh')}
              disabled={busy === 'refresh' || !serverUrl || !token}
            >
              Refresh list
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                await saveSyncConfig({ serverUrl, token });
                await syncNow();
              }}
            >
              Sync first
            </Button>
          </div>
          {backups.length > 0 && (
            <ul className="mt-4 divide-y divide-line">
              {backups.map((backup) => (
                <li key={backup.name} className="flex items-center gap-3 py-2.5">
                  <FileArchive size={15} strokeWidth={1.8} className="text-ink-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[12px] text-ink">{backup.name}</div>
                    <div className="text-[11.5px] text-ink-muted">
                      {formatBytes(backup.size)} · {relativeTime(backup.createdAt)}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    className="h-8 px-2 text-[12px]"
                    onClick={() => void handleDownload(backup.name)}
                    disabled={busy === backup.name}
                  >
                    Download
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-line bg-paper-sunken p-4 text-[12.5px] leading-relaxed text-ink-soft">
          <h2 className="font-serif text-[16px] text-ink">Restoring safely</h2>
          <p className="mt-1">
            Restores merge by object id and only replace records newer than the local copy, so running an import twice
            cannot create duplicates. Deleted items travel as tombstones so a restore does not resurrect them.
          </p>
        </section>
      </div>

      <input ref={fileRef} type="file" className="hidden" onChange={() => setImportOpen(false)} />
      <span className="hidden">{importOpen ? '' : ''}</span>
    </div>
  );
}
