import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, Check, CloudOff, RefreshCw } from 'lucide-react';
import { db } from '../storage/db';
import {
  loadSyncConfig,
  refreshCounters,
  resolveConflict,
  saveSyncConfig,
  syncNow,
  testConnection,
} from '../sync/engine';
import { normalizeServerUrl } from '../sync/client';
import { syncStatus } from '../sync/store';
import { relativeTime } from '../lib/format';
import { navigate } from '../app/router';
import { Button, Field, ScreenHeader, Spinner, TextInput, Toggle, cx } from './ui';

export function SyncScreen() {
  const [serverUrl, setServerUrl] = useState('');
  const [token, setToken] = useState('');
  const [autoSync, setAutoSync] = useState(true);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = useLiveQuery(async () => syncStatus.getSnapshot(), [], syncStatus.getSnapshot());
  const conflicts = useLiveQuery(() => db.conflicts.orderBy('createdAt').reverse().toArray(), []);

  useEffect(() => {
    void (async () => {
      const config = await loadSyncConfig();
      setServerUrl(config.serverUrl);
      setToken(config.token);
      setAutoSync(config.autoSync);
      await refreshCounters();
    })();
  }, []);

  async function handleSave(): Promise<void> {
    const config = await saveSyncConfig({ serverUrl: normalizeServerUrl(serverUrl), token, autoSync });
    setServerUrl(config.serverUrl);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
    await refreshCounters();
  }

  async function handleTest(): Promise<void> {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection(serverUrl, token);
      setTestResult(result);
    } finally {
      setTesting(false);
    }
  }

  async function handleSync(): Promise<void> {
    setSyncing(true);
    setError(null);
    try {
      await saveSyncConfig({ serverUrl, token, autoSync });
      const result = await syncNow();
      if (!result.ok) setError(result.message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="min-h-full pb-[max(2rem,var(--safe-bottom))]">
      <ScreenHeader
        title="Synchronisation"
        subtitle="iPad ↔ Windows laptop, over your local network only"
        onBack={() => navigate('/')}
        actions={
          <Button variant="secondary" onClick={() => void handleSync()} disabled={syncing}>
            {syncing ? <Spinner /> : <RefreshCw size={15} strokeWidth={1.9} />}
            Sync now
          </Button>
        }
      />

      <div className="safe-px mx-auto w-full max-w-3xl space-y-4 pt-5">
        <section
          className={cx(
            'rounded-xl border px-4 py-3',
            status.phase === 'error'
              ? 'border-danger/30 bg-danger/5'
              : status.phase === 'success'
                ? 'border-accent/30 bg-accent-soft'
                : 'border-line bg-paper-raised',
          )}
        >
          <div className="flex items-center gap-2 text-[13.5px] text-ink">
            {status.online ? <Check size={15} strokeWidth={2} /> : <CloudOff size={15} strokeWidth={2} />}
            <span className="font-medium">
              {status.phase === 'syncing'
                ? 'Synchronising…'
                : status.phase === 'success'
                  ? 'Up to date'
                  : status.phase === 'error'
                    ? 'Sync failed'
                    : status.phase === 'unconfigured'
                      ? 'Not configured'
                      : status.online
                        ? 'Ready'
                        : 'Offline'}
            </span>
            <span className="text-ink-muted">· {status.pending} pending · last {relativeTime(status.lastSyncAt)}</span>
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{status.message}</p>
        </section>

        <section className="rounded-xl border border-line bg-paper-raised p-4">
          <h2 className="font-serif text-[17px] text-ink">Windows server</h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
            Start the server with <code className="rounded bg-paper-sunken px-1">scripts\start-server.ps1</code> on the
            laptop, then enter the HTTPS address printed in its window (for example
            <code className="ml-1 rounded bg-paper-sunken px-1">https://192.168.1.20:8443</code>) and the pairing token
            copied from <code className="rounded bg-paper-sunken px-1">backend\storage\pairing-token.txt</code>.
          </p>
          <div className="mt-3 space-y-3">
            <Field label="Server address" hint="HTTPS is required: iOS blocks plain HTTP requests from an installed PWA.">
              <TextInput
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                placeholder="https://192.168.1.20:8443"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </Field>
            <Field label="Pairing token" hint="Stored only in this iPad's IndexedDB and sent only to the address above.">
              <TextInput
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Paste the token from the server"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="font-mono text-[13px]"
              />
            </Field>
            <Toggle
              checked={autoSync}
              onChange={setAutoSync}
              label="Sync automatically"
              description="Pushes queued changes and pulls new ones while the laptop is reachable."
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={() => void handleSave()}>
                {saved ? 'Saved' : 'Save connection'}
              </Button>
              <Button variant="secondary" onClick={() => void handleTest()} disabled={testing}>
                {testing ? <Spinner /> : null}
                Test connection
              </Button>
            </div>
            {testResult && (
              <p className={cx('text-[12.5px]', testResult.ok ? 'text-accent-strong' : 'text-danger')}>
                {testResult.message}
              </p>
            )}
            {error && <p className="text-[12.5px] text-danger">{error}</p>}
          </div>
        </section>

        <section className="rounded-xl border border-line bg-paper-raised p-4">
          <h2 className="font-serif text-[17px] text-ink">Conflicts</h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
            When the same object changed on both devices, both versions are preserved. Choose which one should become
            the canonical copy; the other stays in this list until you discard it.
          </p>
          {(conflicts ?? []).length === 0 ? (
            <p className="mt-3 text-[13px] text-ink-faint">No conflicts recorded.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {(conflicts ?? []).map((conflict) => (
                <li key={conflict.seq} className="flex flex-wrap items-center gap-3 py-3">
                  <AlertTriangle size={16} strokeWidth={1.8} className="text-danger" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] text-ink">{conflict.label}</div>
                    <div className="text-[11.5px] text-ink-muted">
                      {conflict.kind} · recorded {relativeTime(conflict.createdAt)}
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      variant="secondary"
                      className="h-8 px-2.5 text-[12px]"
                      onClick={() => void resolveConflict(conflict.seq!, 'keep-local').then(refreshCounters)}
                    >
                      Keep this iPad
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-8 px-2.5 text-[12px]"
                      onClick={() => void resolveConflict(conflict.seq!, 'keep-server').then(refreshCounters)}
                    >
                      Keep Windows
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-line bg-paper-sunken p-4 text-[12.5px] leading-relaxed text-ink-soft">
          <h2 className="font-serif text-[16px] text-ink">HTTPS on iPadOS</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Copy <code>backend\storage\certs\thoth-rootCA.cer</code> to the iPad (AirDrop, Files or email).</li>
            <li>Install the profile in Settings → General → VPN &amp; Device Management.</li>
            <li>Enable it in Settings → General → About → Certificate Trust Settings.</li>
            <li>
              Use the same hostname the certificate was issued for (the installer prints it, normally
              <code className="mx-1 rounded bg-paper-raised px-1">https://&lt;computer-name&gt;.local:8443</code>).
            </li>
          </ol>
          <p className="mt-2">
            The certificate is generated locally by the installer. No traffic leaves your network; the firewall rule
            only allows private address ranges.
          </p>
        </section>
      </div>
    </div>
  );
}
