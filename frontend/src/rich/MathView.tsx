import { useEffect, useState } from 'react';

/**
 * Renders LaTeX with KaTeX. KaTeX is loaded on demand so a page that contains
 * no equations never pays for it; the stylesheet is bundled locally, so this
 * still works with no network once the app is installed.
 */

const cache = new Map<string, string>();

let stylesheet: Promise<unknown> | null = null;
function ensureStylesheet(): void {
  if (!stylesheet) stylesheet = import('katex/dist/katex.min.css').catch(() => null);
}

function remember(key: string, html: string): string {
  if (cache.size > 400) cache.clear();
  cache.set(key, html);
  return html;
}

export function katexHtml(latex: string, display = false): string {
  return cache.get(`${display ? 'd' : 'i'}${latex}`) ?? '';
}

export function useKatex(latex: string, display = false): string {
  const key = `${display ? 'd' : 'i'}${latex}`;
  const [html, setHtml] = useState(() => cache.get(key) ?? '');

  useEffect(() => {
    const cached = cache.get(key);
    if (cached !== undefined) {
      setHtml(cached);
      return;
    }
    let alive = true;
    ensureStylesheet();
    void import('katex').then((module) => {
      const katex = module.default;
      let markup = '';
      try {
        markup = katex.renderToString(latex || '\\text{ }', {
          displayMode: display,
          throwOnError: false,
          errorColor: '#9b4b3f',
          strict: false,
          trust: false,
        });
      } catch {
        markup = '';
      }
      remember(key, markup);
      if (alive) setHtml(markup);
    });
    return () => {
      alive = false;
    };
  }, [key, latex, display]);

  return html;
}

export function MathView({
  latex,
  size = 22,
  color = 'currentColor',
  display = true,
}: {
  latex: string;
  size?: number;
  color?: string;
  display?: boolean;
}) {
  const html = useKatex(latex, display);
  return (
    <span
      style={{ fontSize: size, color, lineHeight: 1.25 }}
      className="katex-host block max-w-full overflow-hidden"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Preloads KaTeX for panels that show many formulas at once. */
export async function preloadKatex(): Promise<void> {
  ensureStylesheet();
  await import('katex');
}
