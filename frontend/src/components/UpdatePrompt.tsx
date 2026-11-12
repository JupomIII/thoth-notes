import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, X } from 'lucide-react';

/** Prompted update flow: a new build downloads in the background, the user applies it. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // Check for a new deployment every 30 minutes while the app is open.
      window.setInterval(() => void registration.update(), 30 * 60 * 1000);
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="fixed inset-x-0 bottom-[max(1rem,var(--safe-bottom))] z-50 flex justify-center px-4">
      <div className="flex items-center gap-3 rounded-xl border border-line bg-paper-raised px-3 py-2.5 shadow-float">
        <RefreshCw size={17} strokeWidth={1.8} className="text-accent" />
        <div className="text-[12.5px] leading-snug text-ink-soft">
          A new version is ready. Your notes are already saved.
        </div>
        <button
          type="button"
          className="rounded-md bg-accent px-2.5 py-1.5 text-[12px] text-paper-raised"
          onClick={() => void updateServiceWorker(true)}
        >
          Reload
        </button>
        <button
          type="button"
          aria-label="Dismiss update"
          className="rounded p-1 text-ink-muted hover:bg-paper-sunken"
          onClick={() => setNeedRefresh(false)}
        >
          <X size={15} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
