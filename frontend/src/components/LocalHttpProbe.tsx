import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, FlaskConical } from 'lucide-react';
import { Button, Field, Spinner, TextInput, cx } from './ui';

/**
 * Temporary diagnostic card.
 *
 * The GitHub Pages app is served over HTTPS. This card asks the question the
 * whole local-server design depends on: may that page call a bare
 * `http://<lan-ip>:8787` endpoint? It reports exactly what the browser did, and
 * `describe()` keeps the browser's own wording so the result can be quoted.
 */

type Outcome = {
  ok: boolean;
  headline: string;
  detail: string;
};

function hostOf(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).hostname;
  } catch {
    return '';
  }
}

function withHttp(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function describe(failure: unknown): string {
  if (failure instanceof DOMException && failure.name === 'AbortError') return 'no answer within 6 seconds';
  if (failure instanceof TypeError) {
    // Safari: "TypeError: Load failed"; Chromium: "TypeError: Failed to fetch".
    return failure.message || 'the request was refused before any answer';
  }
  if (failure instanceof Error) return `${failure.name}: ${failure.message}`;
  return String(failure);
}

export function LocalHttpProbe({ serverUrl }: { serverUrl: string }) {
  const [address, setAddress] = useState('');
  const [typed, setTyped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typed) return;
    const host = hostOf(serverUrl);
    setAddress(host && !/^127\.|^localhost$/i.test(host) ? `http://${host}:8787` : 'http://192.168.1.100:8787');
  }, [serverUrl, typed]);

  const securePage = typeof window !== 'undefined' && window.location.protocol === 'https:';

  async function probe(): Promise<void> {
    const base = withHttp(address);
    if (!base) {
      setOutcome({ ok: false, headline: 'Enter the probe address first.', detail: '' });
      return;
    }
    setBusy(true);
    setOutcome(null);
    const started = performance.now();

    // Two attempts, because they can fail differently:
    // a CORS fetch, and an opaque no-cors fetch that does not need CORS at all.
    let corsError: unknown = null;
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 6000);
      try {
        const response = await fetch(`${base}/health`, {
          cache: 'no-store',
          mode: 'cors',
          signal: controller.signal,
        });
        const body = (await response.json()) as { device?: string; lanIp?: string; port?: number };
        const elapsed = Math.round(performance.now() - started);
        setOutcome({
          ok: true,
          headline: `Reached the laptop in ${elapsed} ms over plain HTTP.`,
          detail: `${body.device ?? 'The laptop'} · ${body.lanIp ?? '?'}:${body.port ?? 8787}. If this line appears on the iPad from the GitHub Pages app, the HTTP path works and certificates can be dropped.`,
        });
        setBusy(false);
        return;
      } finally {
        window.clearTimeout(timer);
      }
    } catch (failure) {
      corsError = failure;
    }

    let noCorsResult = '';
    try {
      await fetch(`${base}/health`, { cache: 'no-store', mode: 'no-cors' });
      noCorsResult = 'A no-cors request did get through.';
    } catch (failure) {
      noCorsResult = `A no-cors request failed too (${describe(failure)}).`;
    }

    const elapsed = Math.round(performance.now() - started);
    setOutcome({
      ok: false,
      headline: `No request left the page (${elapsed} ms, ${describe(corsError)}).`,
      detail: securePage
        ? `${noCorsResult} This page is HTTPS and the target is HTTP, so the browser treats it as mixed content and blocks it before touching the network. Safari's Web Inspector shows: [blocked] The page at <this address> requested insecure content from <${base}/health>. This content was blocked and must be served over HTTPS.`
        : `${noCorsResult} The page itself is HTTP, so mixed content is not the cause here: check the laptop server is running and that the address is right.`,
    });
    setBusy(false);
  }

  async function copyLink(): Promise<void> {
    const base = withHttp(address);
    if (!base) return;
    try {
      await navigator.clipboard.writeText(`${base}/health`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="rounded-xl border border-dashed border-line-strong bg-paper-sunken p-4">
      <div className="flex items-center gap-2 text-[11.5px] uppercase tracking-wide text-ink-muted">
        <FlaskConical size={13} strokeWidth={1.9} />
        Temporary · local HTTP test
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-soft">
        Answers one question: may this HTTPS page call a plain HTTP server on your own network? Start the probe
        on the laptop first:
        <code className="mx-1 rounded bg-paper-raised px-1.5 py-0.5 font-mono text-[11.5px]">
          python -m app.feasibility
        </code>
        in <code className="font-mono text-[11.5px]">backend</code>. Its window prints the exact address to enter
        here, normally <code className="font-mono text-[11.5px]">http://192.168.x.x:8787</code>.
      </p>

      <div className="mt-3 space-y-2">
        <Field label="Probe address" hint="Plain HTTP, port 8787. No certificate involved.">
          <TextInput
            value={address}
            onChange={(event) => {
              setTyped(true);
              setAddress(event.target.value);
              setOutcome(null);
            }}
            placeholder="http://192.168.1.100:8787"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="font-mono text-[13px]"
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" className="h-9 text-[12.5px]" onClick={() => void probe()} disabled={busy}>
            {busy ? <Spinner /> : null} Run the test
          </Button>
          <Button variant="ghost" className="h-9 text-[12.5px]" onClick={() => void copyLink()}>
            <Copy size={13} strokeWidth={1.9} /> Copy probe link
          </Button>
          {copied && <span className="text-[11.5px] text-accent-strong">Copied</span>}
        </div>
      </div>

      {outcome && (
        <div
          className={cx(
            'mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px] leading-relaxed',
            outcome.ok
              ? 'border-accent/30 bg-accent-soft text-accent-strong'
              : 'border-danger/30 bg-danger/5 text-danger',
          )}
        >
          {outcome.ok ? (
            <Check size={14} strokeWidth={2.2} className="mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle size={14} strokeWidth={2} className="mt-0.5 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="font-medium">{outcome.headline}</p>
            {outcome.detail && <p className="mt-1 opacity-90">{outcome.detail}</p>}
          </div>
        </div>
      )}

      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-faint">
        The copied link is for pasting straight into Safari on the iPad: if it opens, the network path is fine and
        only the browser's mixed-content rule stands in the way. Nothing is stored by this card.
      </p>
    </section>
  );
}
