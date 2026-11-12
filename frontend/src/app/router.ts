import { useEffect, useState } from 'react';

export type Route =
  | { name: 'library' }
  | { name: 'folder'; id: string }
  | { name: 'notebook'; id: string }
  | { name: 'page'; id: string }
  | { name: 'settings' }
  | { name: 'sync' }
  | { name: 'backup' }
  | { name: 'conflicts' };

export function parseRoute(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  const parts = clean.split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'library' };
  const [head, id] = parts;
  switch (head) {
    case 'folder':
      return id ? { name: 'folder', id } : { name: 'library' };
    case 'notebook':
      return id ? { name: 'notebook', id } : { name: 'library' };
    case 'page':
      return id ? { name: 'page', id } : { name: 'library' };
    case 'settings':
      return { name: 'settings' };
    case 'sync':
      return { name: 'sync' };
    case 'backup':
      return { name: 'backup' };
    case 'conflicts':
      return { name: 'conflicts' };
    default:
      return { name: 'library' };
  }
}

export function navigate(path: string): void {
  const target = path.startsWith('#') ? path : `#${path.startsWith('/') ? path : `/${path}`}`;
  if (window.location.hash === target) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  window.location.hash = target;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function routeHref(path: string): string {
  return `#${path.startsWith('/') ? path : `/${path}`}`;
}
