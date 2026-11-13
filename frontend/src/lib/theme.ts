export type ThemeName = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'thoth-theme';

let current: ThemeName = 'system';

export function resolveTheme(theme: ThemeName): 'light' | 'dark' {
  if (theme === 'system') {
    return typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  return theme;
}

/** Applies the palette to the document root; CSS variables do the rest. */
export function applyTheme(theme: ThemeName): void {
  current = theme;
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = resolveTheme(theme);
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private browsing can refuse localStorage; the class above still applies.
  }
}

export function cachedTheme(): ThemeName {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    // ignore
  }
  return 'system';
}

/** Re-applies the theme when iPadOS switches between light and dark. */
export function watchSystemTheme(): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const listener = () => {
    if (current === 'system') applyTheme('system');
  };
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
