import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  Check,
  CloudOff,
  Eye,
  EyeOff,
  ExternalLink,
  Laptop,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { db } from '../storage/db';
import { getDeviceId } from '../storage/repo';
import {
  loadSyncConfig,
  refreshCounters,
  resolveConflict,
  saveSyncConfig,
  syncNow,
  testConnection,
} from '../sync/engine';
import { SyncClient, pairWithCode } from '../sync/client';
import type { ServerStatus } from '../sync/protocol';
import { syncStatus } from '../sync/store';
import { relativeTime } from '../lib/format';
import { navigate } from '../app/router';
import { Button, Field, ScreenHeader, Spinner, TextInput, Toggle, cx } from './ui';
import { LocalHttpProbe } from './LocalHttpProbe';

type Config = Awaited<ReturnType<typeof loadSyncConfig>>;

function cleanCode(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

function withScheme(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const withoutSlash = trimmed.replace(/\/+$/, '');
  return /^https?:\/\//i.test(withoutSlash) ? withoutSlash : `https://${withoutSlash}`;
}

function stepBadge(done: boolean): string {
  return done
    ? 'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[12px] text-paper-raised'
    : 'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line-strong bg-paper-sunken text-[12px] text-ink-muted';
}

function maskToken(token: string): string {
  // Never echo any character of the token: only its length is visible.
  return token ? '•'.repeat(Math.min(20, Math.max(8, token.length))) : '';
}

export function SyncScreen() {
  const [serverUrl, setServerUrl] = useState('');
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [autoSync, setAutoSync] = useState(true);
  const [paired, setPaired] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [destination, setDestination] = useState<ServerStatus | null>(null);
  const [pairing, setPairing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [probe, setProbe] = useState<{ ok: boolean; message: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const started = useRef(false);

  const status = useSyncExternalStore(syncStatus.subscribe, syncStatus.getSnapshot);
  const conflicts = useLiveQuery(() => db.conflicts.orderBy('createdAt').reverse().toArray(), []);
  const showPairForm = !paired || editing;

  async function refreshDestination(config?: Config): Promise<void> {
    const cfg = config ?? (await loadSyncConfig());
    if (!cfg.serverUrl || !cfg.token) {
      setDestination(null);
      return;
    }
    try {
      const deviceId = await getDeviceId();
      setDestination(await new SyncClient(cfg.serverUrl, cfg.token, deviceId).status());
    } catch {
      setDestination(null);
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const hash = window.location.hash;
      const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
      const params = new URLSearchParams(query);
      const linkServer = params.get('server') ?? '';
      const linkCode = cleanCode(params.get('code') ?? '');
      if (query) {
        // The code is short-lived, but keep it out of the address bar and history.
        history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/sync`);
      }

      const config = await loadSyncConfig();
      setServerUrl(linkServer || config.serverUrl);
      setCode(linkCode);
      setToken(config.token);
      setAutoSync(config.autoSync);
      setPaired(Boolean(config.serverUrl && config.token));
      await refreshDestination(config);
      await refreshCounters();

      if (linkServer && linkCode) {
        await pairWith(linkServer, linkCode, { silent: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Opens the laptop's own setup page: the profile is downloaded from there. */
  const trustUrl = withScheme(serverUrl);

  function openSetup(): void {
    if (!trustUrl) {
      setError('Enter the laptop address first.');
      return;
    }
    const url = `${trustUrl}/setup`;
    const opened = window.open(url, '_blank', 'noopener');
    if (!opened) window.location.assign(url);
  }

  /** Probes /api/health: the same call the app makes when it syncs. */
  async function checkLaptop(): Promise<void> {
    if (!trustUrl) {
      setProbe({ ok: false, message: 'Enter the laptop address first.' });
      return;
    }
    setChecking(true);
    setProbe(null);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${trustUrl}/api/health`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`The laptop answered ${response.status}.`);
      const health = (await response.json()) as { deviceName?: string; version?: number };
      setProbe({
        ok: true,
        message: `${health.deviceName ?? 'The laptop'} answered · protocol v${health.version ?? 1}. The certificate is trusted on this iPad.`,
      });
    } catch {
      setProbe({
        ok: false,
        message:
          'No answer. Either the laptop is asleep or off this network, or its certificate is not trusted yet: open the setup page, install the profile, then check again.',
      });
    } finally {
      window.clearTimeout(timer);
      setChecking(false);
    }
  }

  async function pairWith(
    rawUrl: string,
    rawCode: string,
    options: { silent?: boolean } = {},
  ): Promise<void> {
    if (!rawUrl.trim()) {
      setError('Enter the address shown in the server window, for example https://jps_laptop.local:8443');
      return;
    }
    if (cleanCode(rawCode).length !== 6) {
      setError('The pairing code has six characters.');
      return;
    }
    setPairing(true);
    setError(null);
    setNotice(null);
    try {
      const deviceId = await getDeviceId();
      const result = await pairWithCode(rawUrl, cleanCode(rawCode), `iPad ${deviceId.slice(0, 4)}`);
      const config = await saveSyncConfig({
        serverUrl: result.serverUrl || rawUrl,
        token: result.token,
      });
      setServerUrl(config.serverUrl);
      setToken(config.token);
      setPaired(true);
      setEditing(false);
      setCode('');
      setNotice(`Paired with ${result.deviceName || 'your laptop'}. Notes now sync there.`);
      await refreshDestination(config);
      await refreshCounters();
      if (!options.silent) {
        const outcome = await syncNow();
        if (!outcome.ok) setError(outcome.message);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Pairing failed');
    } finally {
      setPairing(false);
    }
  }

  async function handlePair(): Promise<void> {
    await pairWith(serverUrl, code);
  }

  async function handleTokenPair(): Promise<void> {
    if (!serverUrl.trim() || !token.trim()) {
      setError('Enter the laptop address and the pairing token.');
      return;
    }
    const config = await saveSyncConfig({ serverUrl, token });
    setServerUrl(config.serverUrl);
    setToken(config.token);
    setPaired(true);
    setEditing(false);
    setNotice('Token saved on this iPad.');
    await refreshDestination(config);
    await refreshCounters();
  }

  async function handleForget(): Promise<void> {
    await saveSyncConfig({ serverUrl, token: '' });
    setToken('');
    setPaired(false);
    setEditing(false);
    setDestination(null);
    setNotice('This iPad no longer stores the pairing token. Your notes stay on the device.');
    await refreshCounters();
  }

  async function handleSync(): Promise<void> {
    setSyncing(true);
    setError(null);
    try {
      const result = await syncNow();
      if (!result.ok) setError(result.message);
      await refreshDestination();
    } finally {
      setSyncing(false);
    }
  }

  async function handleTest(): Promise<void> {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testConnection(serverUrl, token));
    } finally {
      setTesting(false);
    }
  }

  const sameOrigin = typeof window !== 'undefined' && window.location.protocol === 'https:' &&
    !/github\.io$/.test(window.location.hostname);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ScreenHeader
        title="Synchronisation"
        subtitle={paired ? 'Paired with your laptop' : 'Pair once, then it runs by itself'}
        onBack={() => navigate('/')}
        actions={
          paired ? (
            <Button variant="secondary" onClick={() => void handleSync()} disabled={syncing}>
              {syncing ? <Spinner /> : <RefreshCw size={15} strokeWidth={1.9} />}
              Sync now
            </Button>
          ) : undefined
        }
      />

      <div className="scroll-pane thin-scroll safe-px mx-auto w-full max-w-3xl min-h-0 flex-1 space-y-4 pb-[max(2rem,var(--safe-bottom))] pt-5">
        {notice && (
          <div className="flex items-start gap-2 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-[12.5px] leading-relaxed text-accent-strong">
            <Check size={15} strokeWidth={2} className="mt-0.5 shrink-0" />
            <span>{notice}</span>
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[12.5px] leading-relaxed text-danger">
            {error}
          </div>
        )}

        {paired && !editing ? (
          <section className="rounded-xl border border-line bg-paper-raised p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11.5px] uppercase tracking-wide text-ink-muted">
                  <Laptop size={13} strokeWidth={1.9} /> Destination
                </div>
                <h2 className="mt-1 truncate font-serif text-[20px] text-ink">
                  {destination?.deviceName ?? 'Your laptop'}
                </h2>
                <p className="truncate text-[12.5px] text-ink-muted">{serverUrl}</p>
              </div>
              <span
                className={cx(
                  'mt-1 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px]',
                  destination ? 'bg-accent-soft text-accent-strong' : 'bg-danger/10 text-danger',
                )}
              >
                {destination ? <Check size={12} strokeWidth={2.2} /> : <CloudOff size={12} strokeWidth={2.2} />}
                {destination ? 'reachable' : 'offline'}
              </span>
            </div>

            <dl className="mt-4 space-y-2.5 border-t border-line pt-3 text-[12.5px]">
              <div className="flex items-start gap-2">
                <dt className="w-[104px] shrink-0 text-ink-muted">Notes folder</dt>
                <dd className="min-w-0 flex-1 break-all font-mono text-[11.5px] text-ink-soft">
                  {destination?.dataDir ?? 'Start the server on the laptop to read it'}
                </dd>
              </div>
              <div className="flex items-start gap-2">
                <dt className="w-[104px] shrink-0 text-ink-muted">Stored there</dt>
                <dd className="min-w-0 flex-1 text-ink-soft">
                  {destination
                    ? `${destination.counts.notebook ?? 0} notebooks · ${destination.counts.page ?? 0} pages · ${destination.counts.stroke ?? 0} strokes`
                    : '—'}
                </dd>
              </div>
              <div className="flex items-start gap-2">
                <dt className="w-[104px] shrink-0 text-ink-muted">Credentials</dt>
                <dd className="min-w-0 flex-1">
                  <span className="break-all font-mono text-[11.5px] text-ink-soft">
                    {showToken ? token : maskToken(token)}
                  </span>
                  <button
                    type="button"
                    className="ml-2 inline-flex items-center gap-1 text-[11.5px] text-accent"
                    onClick={() => setShowToken((value) => !value)}
                  >
                    {showToken ? <EyeOff size={13} strokeWidth={1.9} /> : <Eye size={13} strokeWidth={1.9} />}
                    {showToken ? 'Hide' : 'Show'}
                  </button>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
                    Saved in this iPad's local database only: never in the site, the repository or the URL.
                  </p>
                </dd>
              </div>
            </dl>

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <Button variant="primary" onClick={() => void handleSync()} disabled={syncing}>
                {syncing ? <Spinner /> : <RefreshCw size={15} strokeWidth={1.9} />}
                Sync now
              </Button>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Change laptop
              </Button>
              <Button variant="ghost" className="text-danger" onClick={() => void handleForget()}>
                Forget this laptop
              </Button>
            </div>
            <p className="mt-2 text-[11.5px] text-ink-muted">
              {status.online ? 'Ready' : 'Offline'} · {status.pending} change{status.pending === 1 ? '' : 's'} waiting ·{' '}
              synced {relativeTime(status.lastSyncAt)}
            </p>
            <Toggle
              checked={autoSync}
              onChange={async (value) => {
                setAutoSync(value);
                await saveSyncConfig({ autoSync: value });
              }}
              label="Sync automatically"
              description="Pushes queued changes and pulls new ones every 45 seconds while the laptop answers."
            />
          </section>
        ) : null}

        {showPairForm && (
          <section className="rounded-xl border border-line bg-paper-raised p-4">
            <h2 className="font-serif text-[17px] text-ink">Set up this iPad</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
              Two steps, both on this iPad. The trust profile is served by your laptop over your own network:
              nothing is emailed, AirDropped or copied by hand.
            </p>

            <div className="mt-4 space-y-3">
              <Field
                label="Laptop address"
                hint="Printed in the server window. Scanning the QR code on the laptop's pairing page fills this in for you."
              >
                <TextInput
                  value={serverUrl}
                  onChange={(event) => {
                    setServerUrl(event.target.value);
                    setProbe(null);
                  }}
                  placeholder="https://jps_laptop.local:8443"
                  inputMode="url"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </Field>
              {sameOrigin && (
                <Button
                  variant="secondary"
                  className="h-9 text-[12.5px]"
                  onClick={() => {
                    setServerUrl(window.location.origin);
                    setProbe(null);
                  }}
                >
                  Use this laptop ({window.location.host})
                </Button>
              )}
            </div>

            <ol className="mt-5 space-y-4">
              <li className="flex gap-3">
                <span className={stepBadge(Boolean(probe?.ok))}>1</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[14px] text-ink">Trust your laptop</h3>
                    {probe?.ok && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent-strong">
                        <Check size={11} strokeWidth={2.4} /> trusted
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-muted">
                    Open the setup page on this iPad and tap <span className="text-ink">Download the profile</span>.
                    Install it under Settings → General → VPN &amp; Device Management, then switch it on under
                    Settings → General → About → Certificate Trust Settings.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      className="h-9 text-[12.5px]"
                      onClick={() => openSetup()}
                      disabled={!trustUrl}
                    >
                      <ExternalLink size={14} strokeWidth={1.9} /> Open setup page
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-9 text-[12.5px]"
                      onClick={() => void checkLaptop()}
                      disabled={checking}
                    >
                      {checking ? <Spinner /> : null} Check again
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-9 text-[12.5px]"
                      onClick={() => void handleTest()}
                      disabled={testing}
                    >
                      {testing ? <Spinner /> : null} Test connection
                    </Button>
                  </div>
                  {probe && (
                    <p
                      className={cx(
                        'mt-2 text-[12px] leading-relaxed',
                        probe.ok ? 'text-accent-strong' : 'text-ink-muted',
                      )}
                    >
                      {probe.message}
                    </p>
                  )}
                  {testResult && (
                    <p className={cx('mt-1 text-[12px]', testResult.ok ? 'text-accent-strong' : 'text-danger')}>
                      {testResult.message}
                    </p>
                  )}
                </div>
              </li>

              <li className="flex gap-3">
                <span className={stepBadge(paired)}>2</span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[14px] text-ink">Pair</h3>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-muted">
                    Scan the QR code on the laptop's pairing page and this screen opens with the code already filled
                    in, or type the six characters shown there.
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <div className="w-[168px]">
                      <TextInput
                        value={code}
                        onChange={(event) => setCode(cleanCode(event.target.value))}
                        placeholder="AB12CD"
                        inputMode="text"
                        autoCapitalize="characters"
                        autoCorrect="off"
                        spellCheck={false}
                        className="text-center font-mono text-[18px] tracking-[0.35em]"
                      />
                    </div>
                    <Button
                      variant="primary"
                      onClick={() => void handlePair()}
                      disabled={pairing || code.length !== 6 || !serverUrl.trim()}
                    >
                      {pairing ? <Spinner /> : null} Pair
                    </Button>
                    {editing && (
                      <Button variant="ghost" onClick={() => setEditing(false)}>
                        Cancel
                      </Button>
                    )}
                  </div>
                  <p className="mt-1 text-[11.5px] text-ink-faint">
                    Codes change every thirty minutes; the previous one is accepted for one window.
                  </p>
                </div>
              </li>
            </ol>

            <details className="mt-4 rounded-lg bg-paper-sunken px-3 py-2 text-[12.5px] text-ink-soft">
              <summary className="cursor-pointer select-none">Use a pairing token instead</summary>
              <div className="mt-2 space-y-2">
                <TextInput
                  value={token}
                  onChange={(event) => setToken(event.target.value.trim())}
                  placeholder="Token from backend\storage\pairing-token.txt"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="font-mono text-[13px]"
                />
                <Button variant="secondary" className="h-9 text-[12.5px]" onClick={() => void handleTokenPair()}>
                  Save token
                </Button>
              </div>
            </details>
          </section>
        )}

        <section className="rounded-xl border border-line bg-paper-raised p-4">
          <h2 className="font-serif text-[17px] text-ink">Conflicts</h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
            When the same object changed on both devices, both versions are preserved. Choose which one becomes the
            canonical copy.
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
                      Keep laptop
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <LocalHttpProbe serverUrl={serverUrl} />

        <details className="rounded-xl border border-line bg-paper-sunken p-4 text-[12.5px] leading-relaxed text-ink-soft">
          <summary className="flex cursor-pointer select-none items-center gap-2 font-serif text-[16px] text-ink">
            <ShieldCheck size={16} strokeWidth={1.8} /> Certificate and HTTPS help
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Open the laptop's <code>/setup</code> page in Safari on the iPad and accept the warning once.</li>
            <li>Tap <span className="text-ink">Download the profile</span> there: nothing is emailed or AirDropped.</li>
            <li>Settings → General → VPN &amp; Device Management → <em>Thoth Notes Local CA</em> → Install.</li>
            <li>
              Settings → General → About → Certificate Trust Settings → switch it on, then use
              <span className="text-ink"> Check again</span> above.
            </li>
          </ol>
          <p className="mt-2">
            iOS blocks plain HTTP from an installed web app, so the laptop speaks HTTPS with a certificate this iPad
            trusts. The local signing key stays on the laptop, so a new network address renews the certificate
            without installing a second profile. The pairing code never leaves your network and changes every thirty
            minutes.
          </p>
        </details>

        <p className="text-center text-[11.5px] text-ink-faint">
          Notes stay in {destination?.dataDir ?? 'the laptop folder you paired with'} · nothing is uploaded to GitHub.
        </p>
      </div>
    </div>
  );
}
