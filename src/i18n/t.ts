import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import uk from './uk.json';
import en from './en.json';

export type Lang = 'uk' | 'en';
export type Dict = typeof uk;
export type TKey = keyof Dict;
export type T = (key: TKey | (string & {}), vars?: Record<string, string | number>) => string;

const dicts: Record<Lang, Record<string, string>> = { uk, en };

export function makeT(lang: Lang): T {
  const d = dicts[lang] ?? uk;
  return (key, vars) => {
    let s = d[key] ?? (uk as Record<string, string>)[key] ?? key;
    if (vars) for (const k in vars) s = s.split(`{${k}}`).join(String(vars[k]));
    return s;
  };
}

export const locale = (lang: Lang) => (lang === 'en' ? 'en-GB' : 'uk-UA');

export const I18n = createContext<{ lang: Lang; t: T }>({ lang: 'uk', t: makeT('uk') });
export const useT = () => useContext(I18n).t;
export const useLang = () => useContext(I18n).lang;
