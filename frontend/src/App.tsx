import { useEffect, useState, useSyncExternalStore } from 'react';
import { CloudOff } from 'lucide-react';
import { useRoute } from './app/router';
import { LibraryScreen } from './components/LibraryScreen';
import { NotebookScreen } from './components/NotebookScreen';
import { EditorScreen } from './components/EditorScreen';
import { SettingsScreen } from './components/SettingsScreen';
import { SyncScreen } from './components/SyncScreen';
import { BackupScreen } from './components/BackupScreen';
import { getDeviceId, getSettings, saveSettings } from './storage/repo';
import { refreshCounters, startAutoSync, loadSyncConfig } from './sync/engine';
import { syncStatus } from './sync/store';
import { UpdatePrompt } from './components/UpdatePrompt';
import { applyTheme, cachedTheme, watchSystemTheme, type ThemeName } from './lib/theme';

export function App() {
  const route = useRoute();
  const status = useSyncExternalStore(syncStatus.subscribe, syncStatus.getSnapshot);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    let stopWatching: () => void = () => undefined;
    void (async () => {
      try {
        await getDeviceId();
        const settings = await getSettings();
        await saveSettings(settings);
        applyTheme((settings.theme as ThemeName) ?? cachedTheme());
        stopWatching = watchSystemTheme();
        await loadSyncConfig();
        if (navigator.storage?.persist) {
          const already = await navigator.storage.persisted();
          if (!already) await navigator.storage.persist();
        }
        await refreshCounters();
        startAutoSync();
      } catch (error) {
        setFatal(
          error instanceof Error
            ? `Local storage could not be opened: ${error.message}`
            : 'Local storage could not be opened',
        );
      }
    })();

    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as { name?: string; message?: string } | undefined;
      if (reason?.name === 'QuotaExceededError') {
        syncStatus.update({ message: 'Storage is full — export a backup and remove old notebooks.' });
      }
    };
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('unhandledrejection', onRejection);
      stopWatching();
    };
  }, []);

  if (fatal) {
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-danger/30 bg-paper-raised p-5 text-center">
          <h1 className="font-serif text-[20px] text-ink">Storage unavailable</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">{fatal}</p>
          <p className="mt-2 text-[12.5px] text-ink-muted">
            Private browsing and “Block all cookies” both disable IndexedDB on iPadOS. Leave Private Browsing and
            reload.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-hidden">
      {!status.online && (
        <div className="pointer-events-none fixed left-1/2 top-[max(0.5rem,var(--safe-top))] z-40 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-paper-raised/95 px-3 py-1 text-[11.5px] text-ink-soft shadow-sm">
          <CloudOff size={13} strokeWidth={2} />
          Offline — writing is saved on this iPad
        </div>
      )}

      {route.name === 'library' && <LibraryScreen />}
      {route.name === 'folder' && <LibraryScreen folderId={route.id} />}
      {route.name === 'notebook' && <NotebookScreen notebookId={route.id} />}
      {route.name === 'page' && <EditorScreen pageId={route.id} />}
      {route.name === 'settings' && <SettingsScreen />}
      {route.name === 'sync' && <SyncScreen />}
      {route.name === 'backup' && <BackupScreen />}
      {route.name === 'conflicts' && <SyncScreen />}

      <UpdatePrompt />
    </div>
  );
}
