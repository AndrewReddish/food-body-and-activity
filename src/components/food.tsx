import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import type { DateKey, FoodLog, Method, PlanGroup, PlanItem } from '../model/types';
import { DONE_AT, fromRaw, groupUse, makeLog, methodsFor, remainingWeighed, roundAmount, toRaw, yieldOf } from '../model/cooking';
import { useLang, useT, type Lang } from '../i18n/t';
import { fromDateKey } from '../lib/dates';
import { nowIso } from '../lib/dates';
import { sound } from '../lib/sound';
import { Burst, Button, Icon, IconButton, Sheet, domainVars } from './ui';

export const groupLabel = (g: PlanGroup, lang: Lang) => (lang === 'en' ? g.labelEn : g.labelUk);
export const itemName = (i: PlanItem, lang: Lang) => (lang === 'en' ? i.nameEn : i.nameUk);
export const pct = (frac: number) => Math.round(frac * 100);
const fmt = (n: number, lang: Lang) => new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'uk-UA', { maximumFractionDigits: 1 }).format(n);

export const METHOD_ICON: Record<Method, string> = { raw: 'leaf', boiled: 'pot', baked: 'oven', fried: 'pan' };

/** Progress ring. Above 100% the overflow is drawn on top in the warning colour. */
export function Ring({ value, size = 64, stroke = 7, children, label }: {
  value: number; size?: number; stroke?: number; children?: ComponentChildren; label?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const main = Math.min(1, Math.max(0, value));
  const over = Math.min(1, Math.max(0, value - 1));
  return (
    <span class={'sf-ring' + (value >= DONE_AT ? ' is-full' : '')} style={`width:${size}px;height:${size}px`} role={label ? 'img' : undefined} aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle class="sf-ring__track" cx={size / 2} cy={size / 2} r={r} stroke-width={stroke} />
        <circle class="sf-ring__arc" cx={size / 2} cy={size / 2} r={r} stroke-width={stroke}
          stroke-dasharray={c} stroke-dashoffset={c * (1 - main)} />
        {over > 0 && (
          <circle class="sf-ring__over" cx={size / 2} cy={size / 2} r={r} stroke-width={stroke}
            stroke-dasharray={c} stroke-dashoffset={c * (1 - over)} />
        )}
      </svg>
      {children && <span class="sf-ring__mid">{children}</span>}
    </span>
  );
}

/** The letter chip from the coach's plan (а, б, в …) in the group's colour. */
export const GroupChip = ({ group, size = 36 }: { group: PlanGroup; size?: number }) => (
  <span class="sf-gchip" style={`${domainVars(group.palette)};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.5)}px`} aria-hidden="true">
    {group.letter}
  </span>
);

/** Thin bar, e.g. protein against the macro target. */
export const Bar = ({ value, color = 'var(--accent)' }: { value: number; color?: string }) => (
  <span class="sf-bar" style={`--c:${color}`}><span style={`width:${Math.min(100, value * 100)}%`} /></span>
);

/** Week strip: one mini ring per day showing how much of the ration was covered. */
export function DayStrip({ days, today, selected, onSelect }: {
  days: { date: DateKey; value?: number }[]; today: DateKey; selected: DateKey; onSelect: (d: DateKey) => void;
}) {
  const lang = useLang();
  const wd = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'uk-UA', { weekday: 'short' });
  return (
    <div class="sf-days" role="tablist">
      {days.map(({ date, value }) => {
        const d = fromDateKey(date);
        return (
          <button type="button" role="tab" aria-selected={date === selected} class={'sf-day sf-press' + (date === selected ? ' is-on' : '')}
            onClick={() => { if (date !== selected) sound('tick', 3); onSelect(date); }}>
            <span class="sf-day__wd">{date === today ? '•' : wd.format(d).replace('.', '')}</span>
            <Ring value={value ?? 0} size={30} stroke={4}><span class="sf-day__n" style="font-size:12px">{d.getDate()}</span></Ring>
          </button>
        );
      })}
    </div>
  );
}

const unitLabel = (unit: PlanItem['unit'], t: ReturnType<typeof useT>) => t('unit.' + unit);

/**
 * Log (or edit) one food. The amount is entered as weighed, in the chosen state; the plan
 * always counts raw weight, so cooked amounts are converted with the food type's yield.
 * The slider stops at what's left in the group; typing more is allowed but flagged.
 */
export function LogSheet({ item, group, food, editing, initialMethod, onSave, onDelete, onClose }: {
  item: PlanItem; group: PlanGroup; food: FoodLog[]; editing?: FoodLog; initialMethod?: Method;
  onSave: (log: FoodLog) => void; onDelete?: (id: string) => void; onClose: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const methods = methodsFor(item.cook);
  const [method, setMethod] = useState<Method>(editing?.method ?? (initialMethod && methods.includes(initialMethod) ? initialMethod : 'raw'));
  const [amount, setAmount] = useState<number>(editing?.weighed ?? 0);
  const [text, setText] = useState(editing ? String(editing.weighed) : '');
  const u = unitLabel(item.unit, t);
  const step = item.unit === 'pcs' ? 1 : 5;

  const used = groupUse(food, editing?.id)[group.id] ?? 0;
  const maxW = roundAmount(remainingWeighed(item, method, used), item.unit);
  const preview = useMemo(() => makeLog(item, group, method, amount, editing?.id ?? 'preview', editing?.at ?? nowIso()), [item, group, method, amount]);
  const after = used + preview.frac;
  const overBy = after > 1.005 ? roundAmount(fromRaw((after - 1) * item.max, item.cook, method), item.unit) : 0;
  const sliderMax = Math.max(maxW, step);

  const set = (n: number, fromText = false) => {
    const v = Math.max(0, Math.min(99999, n));
    if (v !== amount && !fromText) sound('tick', 3);
    setAmount(v);
    if (!fromText) setText(v ? String(v) : '');
  };
  /** Switching raw ↔ cooked keeps the same food: the raw amount stays, the weighed number converts. */
  const switchMethod = (m: Method) => {
    if (m === method) return;
    sound('toggle');
    const raw = toRaw(amount, item.cook, method);
    setMethod(m);
    set(roundAmount(fromRaw(raw, item.cook, m), item.unit));
  };

  const y = yieldOf(item.cook, method);
  return (
    <Sheet onClose={onClose} labelledBy="log-title" style={domainVars(group.palette)}>
      {(close) => (<>
        <div class="sf-sheet__head">
          <GroupChip group={group} size={40} />
          <div style="flex:1;display:grid;gap:2px;min-width:0">
            <h2 class="sf-h2" id="log-title" style="line-height:1.2">{itemName(item, lang)}</h2>
            <span class="sf-meta">
              {used > 0
                ? t('log.left', { left: fmt(roundAmount(remainingWeighed(item, 'raw', used), item.unit), lang), max: fmt(item.max, lang), unit: u })
                : t('log.recommend', { max: fmt(item.max, lang), unit: u })}
              {item.note ? ` · ${item.note}` : ''}
            </span>
          </div>
          <IconButton icon="close" label={t('common.close')} tone="sunk" size={22} onClick={close} />
        </div>

        <div class="log-used">
          <span>{t('log.used', { pct: pct(used) })}</span>
          <Bar value={used} color="var(--c)" />
        </div>

        {methods.length > 1 && (
          <div class="stack">
            <span class="sf-label">{t('log.method')}</span>
            <div class="sf-seg log-methods" role="radiogroup" aria-label={t('log.method')}>
              {methods.map((m) => (
                <button type="button" role="radio" aria-checked={m === method} onClick={() => switchMethod(m)}>
                  <Icon name={METHOD_ICON[m]} size={20} />
                  <span>{t('method.' + m)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div class="log-amount">
          <label class="sf-label" for="amount">{t('log.amount', { unit: u })}</label>
          <div class="log-amount__row">
            <IconButton icon="minus" label={t('log.less')} tone="sunk" onClick={() => set(Math.max(0, amount - step))} />
            <input id="amount" class="sf-input sf-input--ui log-amount__input" inputMode="decimal" enterKeyHint="done" value={text} placeholder="0"
              aria-describedby="amount-hint"
              onInput={(e) => {
                const v = (e.currentTarget as HTMLInputElement).value.replace(',', '.');
                setText(v);
                const n = parseFloat(v);
                set(Number.isFinite(n) ? n : 0, true);
              }} />
            <IconButton icon="plus" label={t('log.more')} tone="sunk" onClick={() => set(amount + step)} />
          </div>
          <span class="sf-meta" id="amount-hint">
            {maxW > 0 ? t('log.max', { n: fmt(maxW, lang), unit: u, method: item.unit === 'pcs' && method === 'raw' ? '' : t('method.' + method + '.short') }).trim() : t('log.nothingLeft')}
          </span>
        </div>

        {maxW > 0 && (
          <div class="sf-slider sf-slider--flat" style={`--p:${Math.min(100, (amount / sliderMax) * 100)}%`}>
            <input type="range" min="0" max={sliderMax} step={item.unit === 'pcs' ? 1 : Math.max(1, Math.round(sliderMax / 100))} value={Math.min(amount, sliderMax)}
              aria-label={t('log.amount', { unit: u })} onInput={(e) => set(+(e.currentTarget as HTMLInputElement).value)} />
          </div>
        )}
        {maxW > 0 && (
          <div class="log-quick">
            {[0.25, 0.5, 0.75, 1].map((p) => (
              <button type="button" class="sf-chip sf-press" onClick={() => { sound('chipOn'); set(roundAmount(maxW * p, item.unit)); }}>
                {p === 1 ? t('log.all') : `${p * 100}%`}
              </button>
            ))}
          </div>
        )}

        {method !== 'raw' && y !== 1 && (
          <p class="log-convert sf-fadeup" key={method}>
            <Icon name={METHOD_ICON[method]} size={18} />
            <span>{t('log.convert', { weighed: fmt(amount, lang), raw: fmt(preview.raw, lang), unit: u, method: t('method.' + method + '.short'), y: fmt(y, lang) })}</span>
          </p>
        )}

        <div class="log-stats" aria-live="polite">
          <div><b class="sf-bump" key={preview.kcal}>{preview.kcal}</b><span>{t('unit.kcal')}</span></div>
          <div><b class="sf-bump" key={preview.protein}>{fmt(preview.protein, lang)}</b><span>{t('log.protein')}</span></div>
          <div><b class={'sf-bump' + (overBy ? ' is-over' : '')} key={pct(after)}>{pct(after)}%</b><span>{t('log.after')}</span></div>
        </div>
        {overBy > 0 && <div class="sf-banner is-warn" role="alert"><Icon name="info" /><span>{t('log.over', { n: fmt(overBy, lang), unit: u })}</span></div>}

        <div class="sf-sheet__actions">
          <Button block icon="check" disabled={amount <= 0} onClick={() => { onSave({ ...preview, id: editing?.id ?? newId(), at: editing?.at ?? nowIso() }); close(); }}>
            {editing ? t('log.update') : t('log.confirm')}
          </Button>
          {editing && onDelete && <Button variant="ghost" icon="trash" onClick={() => { sound('clear'); onDelete(editing.id); close(); }}>{t('log.delete')}</Button>}
        </div>
      </>)}
    </Sheet>
  );
}

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** "При смажінні обов'язково враховуйте олію": one tap to log the oil into group г. */
export function OilSheet({ onAdd, onClose }: { onAdd: (g: number) => void; onClose: () => void }) {
  const t = useT();
  return (
    <Sheet onClose={onClose} labelledBy="oil-title" style={domainVars('money')}>
      {(close) => (<>
        <div class="sf-sheet__head">
          <span class="sf-dchip sf-dchip--lg"><Icon name="pan" size={22} /></span>
          <h2 class="sf-h2" id="oil-title" style="flex:1">{t('oil.title')}</h2>
          <IconButton icon="close" label={t('common.close')} tone="sunk" size={22} onClick={close} />
        </div>
        <p class="sf-meta">{t('oil.body')}</p>
        <div class="log-quick">
          {[3, 5, 10, 15].map((g) => (
            <button type="button" class="sf-chip sf-press" onClick={() => { sound('bloom', 3); onAdd(g); close(); }}>{t('oil.g', { n: g })}</button>
          ))}
        </div>
        <Button variant="ghost" onClick={close}>{t('oil.skip')}</Button>
      </>)}
    </Sheet>
  );
}

/** The coach's rules, condensed. */
export function RulesSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const rules = ['raw', 'limit', 'swap', 'fry', 'liquid', 'drinks', 'water', 'soda', 'last', 'weigh'];
  return (
    <Sheet onClose={onClose} labelledBy="rules-title">
      {(close) => (<>
        <div class="sf-sheet__head">
          <span class="sf-dchip sf-dchip--lg" style="background:var(--accent-soft);color:var(--accent-ink)"><Icon name="info" size={22} /></span>
          <h2 class="sf-h2" id="rules-title" style="flex:1">{t('rules.title')}</h2>
          <IconButton icon="close" label={t('common.close')} tone="sunk" size={22} onClick={close} />
        </div>
        <ul class="rules">
          {rules.map((r) => <li>{t('rules.' + r)}</li>)}
        </ul>
        <Button block onClick={close}>{t('common.done')}</Button>
      </>)}
    </Sheet>
  );
}

/** Celebrates the moment the whole ration is covered. */
export function DoneBurst() {
  return <span style="position:absolute;inset:0;display:grid;place-items:center;pointer-events:none"><Burst count={10} distance={48} /></span>;
}
