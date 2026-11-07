import { useEffect, useState } from 'preact/hooks';

export type Tab = 'today' | 'ration' | 'steps' | 'measures' | 'settings';
/** Screens outside the tab bar: the food history (#/history). */
export type Route = { name: Tab | 'history'; date?: string };

const TABS: Tab[] = ['today', 'ration', 'steps', 'measures', 'settings'];

/** Hash routing (GitHub Pages has no SPA fallback): #/today, #/ration/2026-11-01, #/steps … */
export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const date = parts[1] && /^\d{4}-\d{2}-\d{2}$/.test(parts[1]) ? parts[1] : undefined;
  if (parts[0] === 'day') return { name: 'today', date };
  if (parts[0] === 'history') return { name: 'history' };
  const name = TABS.includes(parts[0] as Tab) ? (parts[0] as Tab) : 'today';
  return { name, date };
}

export const go = (path: string) => {
  location.hash = '#/' + path;
};

/** Link to a tab that keeps the chosen day (today drops the date). */
export const tabHref = (tab: Tab, date: string | undefined, today: string) =>
  '#/' + tab + (date && date !== today && tab !== 'measures' && tab !== 'settings' ? '/' + date : '');

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const f = () => {
      setRoute(parseHash(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return route;
}
