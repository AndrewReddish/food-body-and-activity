import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { sound } from '../lib/sound';
import { useT } from '../i18n/t';
import { tabHref, type Tab } from '../lib/router';
import { todayKey } from '../lib/dates';

const BASE = import.meta.env.BASE_URL;
export const asset = (p: string) => BASE + p;

export const domainVars = (palette: string) =>
  `--c: var(--d-${palette}); --c-soft: var(--d-${palette}-soft); --c-ink: var(--d-${palette}-ink)`;

export function Icon({ name, size = 24, label, class: cls = '' }: { name: string; size?: number; label?: string; class?: string }) {
  return (
    <svg
      class={'sf-icon ' + cls}
      width={size}
      height={size}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      focusable="false"
    >
      <use href={`${asset('icons.svg')}#${name}`} />
    </svg>
  );
}

export const Illustration = ({ name, alt = '', width = 200, height = 150 }: { name: string; alt?: string; width?: number; height?: number }) => (
  <img src={asset(`illustrations/${name}.svg`)} alt={alt} width={width} height={height} decoding="async" />
);

type BtnProps = Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'icon'> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  block?: boolean;
  icon?: string;
  iconEnd?: string;
  disabled?: boolean;
  children?: ComponentChildren;
};
export function Button({ variant = 'primary', block, icon, iconEnd, children, ...rest }: BtnProps) {
  return (
    <button type="button" class={`sf-btn sf-btn--${variant}${block ? ' sf-btn--block' : ''}`} {...rest}>
      {icon && <Icon name={icon} size={22} />}
      {children}
      {iconEnd && <Icon name={iconEnd} size={22} />}
    </button>
  );
}

export const IconButton = ({ icon, label, tone, size = 24, ...rest }: { icon: string; label: string; tone?: 'surface' | 'sunk'; size?: number } & JSX.HTMLAttributes<HTMLButtonElement> & { disabled?: boolean; type?: 'button' | 'submit' }) => (
  <button type="button" class={`sf-iconbtn sf-press${tone ? ' sf-iconbtn--' + tone : ''}`} aria-label={label} {...rest}>
    <Icon name={icon} size={size} />
  </button>
);

export const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A little burst of petals from the centre of its (position: relative) parent. Re-key to replay. */
export function Burst({ count = 7, distance = 34 }: { count?: number; distance?: number }) {
  return (
    <span class="sf-burst" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span style={`--a:${(360 / count) * i + 12}deg;--d:${distance + (i % 2) * 8}px;--delay:${(i % 3) * 25}ms`} />
      ))}
    </span>
  );
}

export function Chip({ selected, onClick, children, palette }: { selected: boolean; onClick: () => void; children: ComponentChildren; palette?: string }) {
  return (
    <button type="button" class="sf-chip sf-press" aria-pressed={selected} style={palette ? domainVars(palette) : ''}
      onClick={() => { sound(selected ? 'chipOff' : 'chipOn'); onClick(); }}>
      {selected && <Icon name="check" size={18} />}
      {children}
    </button>
  );
}

export function TextField({ id, label, value = '', placeholder, multiline, onInput, maxLength, ui }: {
  id: string; label: string; value?: string; placeholder?: string; multiline?: boolean; onInput: (v: string) => void; maxLength?: number; ui?: boolean;
}) {
  const cls = 'sf-input' + (ui ? ' sf-input--ui' : '');
  const handler = (e: Event) => onInput((e.currentTarget as HTMLInputElement).value);
  return (
    <div class="sf-field">
      <label class="sf-field__label" for={id}>{label}</label>
      {multiline ? (
        <textarea id={id} class={cls} rows={4} value={value} placeholder={placeholder} maxLength={maxLength} onInput={handler} />
      ) : (
        <input id={id} class={cls} value={value} placeholder={placeholder} maxLength={maxLength} onInput={handler} autoComplete="off" />
      )}
    </div>
  );
}

export const Toggle = ({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) => (
  <button type="button" role="switch" class="sf-switch" aria-checked={checked} aria-label={label} onClick={() => { sound('toggle'); onChange(!checked); }}>
    <span>{checked && <Icon name="check" size={16} />}</span>
  </button>
);

export function Segmented<V extends string>({ options, value, onChange, label }: {
  options: { value: V; label: string }[]; value: V; onChange: (v: V) => void; label: string;
}) {
  return (
    <div class="sf-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button type="button" role="radio" aria-checked={o.value === value} onClick={() => { if (o.value !== value) sound('toggle'); onChange(o.value); }}>{o.label}</button>
      ))}
    </div>
  );
}

/** Five tabs; the chosen day travels with you between Головна, Раціон and Кроки. */
export function TabBar({ active, date, dot }: { active: Tab; date?: string; dot?: Partial<Record<Tab, boolean>> }) {
  const t = useT();
  const today = todayKey();
  const tabs: { id: Tab; icon: string }[] = [
    { id: 'today', icon: 'today' }, { id: 'ration', icon: 'ration' }, { id: 'steps', icon: 'steps' },
    { id: 'measures', icon: 'measures' }, { id: 'settings', icon: 'settings' },
  ];
  return (
    <nav class="sf-tabs" aria-label={t('app.name')}>
      {tabs.map(({ id, icon }) => (
        <a class="sf-tab sf-press" href={tabHref(id, date, today)} aria-current={active === id ? 'page' : undefined} onClick={() => active !== id && sound('tick', 4)}>
          <span style="position:relative"><Icon name={icon} />{dot?.[id] && <span class="sf-tab__dot" />}</span>
          <span>{t('tab.' + id)}</span>
        </a>
      ))}
    </nav>
  );
}

type SheetChildren = ComponentChildren | ((close: () => void) => ComponentChildren);

/**
 * Bottom sheet that springs up and slides away. Pass children as a function to get an
 * animated `close` for buttons inside; `onClose` runs once the exit animation ends.
 */
export function Sheet({ onClose, labelledBy, style, silent, children }: {
  onClose: () => void; labelledBy: string; style?: string; silent?: boolean; children: SheetChildren;
}) {
  const [closing, setClosing] = useState(false);
  useEffect(() => { if (!silent) sound('sheetOpen'); }, []);
  const close = () => {
    if (closing) return;
    if (!silent) sound('sheetClose');
    if (reducedMotion()) return onClose();
    setClosing(true);
    setTimeout(onClose, 240);
  };
  return (
    <>
      <div class={'sf-sheet-scrim' + (closing ? ' is-closing' : '')} onClick={close} />
      <section
        class={'sf-sheet' + (closing ? ' is-closing' : '')} role="dialog" aria-modal="true" aria-labelledby={labelledBy} style={style}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      >
        <div class="sf-sheet__handle" />
        {typeof children === 'function' ? children(close) : children}
      </section>
    </>
  );
}

/** Petals drifting down over the "day saved" illustration. Deterministic, so no layout jitter. */
export function PetalRain({ count = 14 }: { count?: number }) {
  const palettes = ['home', 'leisure', 'relationships', 'nature', 'mood', 'sleep'];
  return (
    <span class="sf-rain" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span
          style={`--x:${(i * 37) % 100}%;--delay:${(i * 90) % 700}ms;--dur:${1500 + ((i * 53) % 700)}ms;--rot:${(i * 47) % 360}deg;--drift:${((i % 5) - 2) * 14}px;background:var(--d-${palettes[i % palettes.length]})`}
        />
      ))}
    </span>
  );
}
