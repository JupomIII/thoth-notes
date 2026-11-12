import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Database, Fingerprint, HardDrive, Info, ShieldCheck } from 'lucide-react';
import { db } from '../storage/db';
import type { AppSettings } from '../storage/types';
import { getDeviceId, getSettings, saveSettings } from '../storage/repo';
import { loadSyncConfig, refreshCounters, saveSyncConfig } from '../sync/engine';
import { formatBytes } from '../lib/download';
import { navigate } from '../app/router';
import { Button, Field, ScreenHeader, TextInput, Toggle, cx } from './ui';

export function SettingsScreen() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [autoSync, setAutoSync] = useState(true);
  const [serverUrl, setServerUrl] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const counts = useLiveQuery(
    async () => ({
      notebooks: await db.notebooks.count(),
      pages: await db.pages.count(),
      strokes: await db.strokes.count(),
    }),
    [],
  );

  useEffect(() => {
    void (async () => {
      setSettings(await getSettings());
      setDeviceId(await getDeviceId());
      const config = await loadSyncConfig();
      setAutoSync(config.autoSync);
      setServerUrl(config.serverUrl);
      if (navigator.storage) {
        setPersisted(await navigator.storage.persisted());
        const estimate = await navigator.storage.estimate();
        setUsage({ used: estimate.usage ?? 0, quota: estimate.quota ?? 0 });
      }
      await refreshCounters();
    })();
  }, []);

  async function update(patch: Partial<AppSettings>): Promise<void> {
    const next = await saveSettings(patch);
    setSettings(next);
  }

  async function requestPersistence(): Promise<void> {
    if (!navigator.storage?.persist) {
      setMessage('This browser does not expose persistent storage.');
      return;
    }
    const granted = await navigator.storage.persist();
    setPersisted(granted);
    setMessage(
      granted
        ? 'Storage is persistent. Safari will not evict your notebooks under storage pressure.'
        : 'Safari did not grant persistence. Keep regular backups from the backup screen.',
    );
  }

  return (
    <div className="min-h-full pb-[max(2rem,var(--safe-bottom))]">
      <ScreenHeader title="Settings" onBack={() => navigate('/')} />

      <div className="safe-px mx-auto w-full max-w-3xl space-y-4 pt-5">
        {message && (
          <div className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-[12.5px] text-accent-strong">
            {message}
          </div>
        )}

        <section className="rounded-xl border border-line bg-paper-raised p-4">
          <h2 className="font-serif text-[17px] text-ink">Writing</h2>
          <div className="mt-1 divide-y divide-line">
            <Toggle
              checked={settings?.oneFingerPan ?? true}
              onChange={(value) => void update({ oneFingerPan: value })}
              label="Pan with one finger"
              description="A single finger scrolls the page; only Apple Pencil draws."
            />
            <Toggle
              checked={settings?.palmRejection ?? true}
              onChange={(value) => void update({ palmRejection: value })}
              label="Palm rejection"
              description="Ignores touch input while the pencil is in contact and just after it lifts."
            />
            <Toggle
              checked={settings?.showPageBoundary ?? false}
              onChange={(value) => void update({ showPageBoundary: value })}
              label="Show page boundary"
              description="Draws a hairline around the sheet; turn off for a borderless page."
            />
          </div>
        </section>

        <section className="rounded-xl border border-line bg-paper-raised p-4">
          <h2 className="font-serif text-[17px] text-ink">Storage</h2>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-paper-sunken p-3">
              <div className="flex items-center gap-2 text-[12px] uppercase tracking-wide text-ink-muted">
                <HardDrive size={14} strokeWidth={1.8} /> Used
              </div>
              <div className="mt-1 font-serif text-[19px] text-ink">{usage ? formatBytes(usage.used) : '…'}</div>
              <div className="text-[11.5px] text-ink-muted">
                of {usage ? formatBytes(usage.quota) : '…'} available
              </div>
            </div>
            <div className="rounded-lg bg-paper-sunken p-3">
              <div className="flex items-center gap-2 text-[12px] uppercase tracking-wide text-ink-muted">
                <Database size={14} strokeWidth={1.8} /> Content
              </div>
              <div className="mt-1 font-serif text-[19px] text-ink">{counts?.strokes ?? 0} strokes</div>
              <div className="text-[11.5px] text-ink-muted">
                {counts?.notebooks ?? 0} notebooks · {counts?.pages ?? 0} pages
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant={persisted ? 'secondary' : 'primary'}
              icon={<ShieldCheck size={16} strokeWidth={1.8} />}
              onClick={() => void requestPersistence()}
            >
              {persisted ? 'Persistent storage granted' : 'Request persistent storage'}
            </Button>
            <Button variant="ghost" onClick={() => navigate('/backup')}>
              Backups
            </Button>
          </div>
          {persisted === false && (
            <p className="mt-2 text-[12px] text-ink-muted">
              Without persistence, iPadOS may clear the site's data if storage runs low. Export a backup weekly.
            </p>
          )}
        </section>

        <section className="rounded-xl border border-line bg-paper-raised p-4">
          <h2 className="font-serif text-[17px] text-ink">Synchronisation</h2>
          <div className="mt-2 space-y-3">
            <Field label="Server address">
              <TextInput
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                placeholder="https://192.168.1.20:8443"
                inputMode="url"
                autoCapitalize="off"
              />
            </Field>
            <Toggle
              checked={autoSync}
              onChange={async (value) => {
                setAutoSync(value);
                await saveSyncConfig({ serverUrl, autoSync: value });
              }}
              label="Sync in the background"
              description="Runs every 45 seconds while the app is open and the laptop answers."
            />
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={async () => {
                  await saveSyncConfig({ serverUrl, autoSync });
                  setMessage('Server address saved.');
                }}
              >
                Save address
              </Button>
              <Button variant="ghost" onClick={() => navigate('/sync')}>
                Full sync settings
              </Button>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-line bg-paper-raised p-4">
          <h2 className="font-serif text-[17px] text-ink">This device</h2>
          <div className="mt-2 space-y-2 text-[12.5px] text-ink-muted">
            <div className="flex items-center gap-2">
              <Fingerprint size={15} strokeWidth={1.8} />
              <span className="font-mono text-[11.5px] break-all">{deviceId || '…'}</span>
            </div>
            <p>
              Device id is used for deterministic conflict tie-breaks. It is generated once and never shared outside
              your own devices.
            </p>
          </div>
        </section>

        <section className={cx('rounded-xl border border-line bg-paper-sunken p-4 text-[12.5px] leading-relaxed text-ink-soft')}>
          <h2 className="flex items-center gap-2 font-serif text-[16px] text-ink">
            <Info size={16} strokeWidth={1.8} /> Known limits on iPadOS
          </h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            <li>
              Safari exposes <code>pointerType</code>, pressure and tilt to web apps, but not the pencil's azimuth or
              hover distance. Tilt is mapped to nib width; azimuth-based shading is not possible.
            </li>
            <li>
              Palm rejection is implemented by suppressing touch input while the pencil is down. iOS may still deliver
              stray touches at the very start of a stroke; the pencil always wins.
            </li>
            <li>
              Two-finger rotation is not enabled — it conflicts with pinch zoom during fast writing. Use pinch to zoom
              and one-finger drag to pan.
            </li>
            <li>
              Installed PWAs cannot call <code>http://</code> addresses. Run the Windows server with its HTTPS
              certificate as documented, or open the app from the server's own origin.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
