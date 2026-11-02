import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Measure, MeasureField } from '../model/types';
import { MEASURE_FIELDS, SCHEMA_VERSION } from '../model/schema';
import { useLang, useT, locale } from '../i18n/t';
import { addDays, fromDateKey, nowIso, todayKey } from '../lib/dates';
import { measureStats, useMeasures } from '../lib/useMeasures';
import { sound } from '../lib/sound';
import { putPhoto, type TiloDB } from '../storage/db';
import { Button, Icon, IconButton, Illustration, Sheet, TabBar } from '../components/ui';
import { newId } from '../components/food';
import { MEASURE_EVERY } from './Today';

const TAPE: MeasureField[] = ['waist', 'hips', 'chest', 'arm', 'thigh'];

export function Measures() {
  const t = useT();
  const lang = useLang();
  const { list, loaded, save, store } = useMeasures();
  const [edit, setEdit] = useState<Measure | 'new' | null>(null);
  const [compare, setCompare] = useState(false);
  const stats = measureStats(list);
  const nf = new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 1 });
  const df = new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'short' });
  const withPhotos = list.filter((m) => m.photos?.length);
  const today = todayKey();
  const due = !stats.lastDate || stats.lastDate < addDays(today, -MEASURE_EVERY);
  const firstOf = (f: MeasureField) => list.find((m) => m[f] !== undefined)?.[f] as number | undefined;
  const lastOf = (f: MeasureField) => [...list].reverse().find((m) => m[f] !== undefined)?.[f] as number | undefined;

  return (
    <>
      <main class="screen">
        <header class="screen__head">
          <h1 class="sf-title" style="padding-top:10px">{t('tab.measures')}</h1>
          <p class="sf-meta">{due ? t('measures.due') : t('measures.next', { date: df.format(fromDateKey(addDays(stats.lastDate!, MEASURE_EVERY))) })}</p>
        </header>

        {loaded && !list.length ? (
          <div class="sf-empty">
            <Illustration name="body" width={200} height={150} />
            <p class="sf-h2">{t('measures.empty')}</p>
            <p class="sf-meta">{t('measures.emptyHint')}</p>
          </div>
        ) : (
          <>
            <div class="sf-card measure-stats">
              <div><span>{t('measures.start')}</span><b>{stats.first ? nf.format(stats.first.weight!) : '—'}</b><small>{stats.first ? df.format(fromDateKey(stats.first.date)) : ''}</small></div>
              <div><span>{t('measures.now')}</span><b>{stats.last ? nf.format(stats.last.weight!) : '—'}</b><small>{stats.last ? df.format(fromDateKey(stats.last.date)) : ''}</small></div>
              <div><span>{t('measures.change')}</span>
                <b class={stats.delta ? (stats.delta < 0 ? 'is-down' : 'is-up') : ''}>{stats.delta ? `${stats.delta < 0 ? '−' : '+'}${nf.format(Math.abs(stats.delta))}` : '—'}</b>
                <small>{t('unit.kg')}</small></div>
            </div>
            {list.filter((m) => m.weight !== undefined).length > 1 && <WeightChart list={list} />}

            {TAPE.some((f) => lastOf(f) !== undefined) && (
              <div class="sf-list">
                {TAPE.filter((f) => lastOf(f) !== undefined).map((f) => {
                  const d = Math.round(((lastOf(f) ?? 0) - (firstOf(f) ?? 0)) * 10) / 10;
                  return (
                    <div class="sf-row">
                      <span class="sf-row__title" style="flex:1">{t('field.' + f)}</span>
                      {d !== 0 && <span class={'measure-d ' + (d < 0 ? 'is-down' : 'is-up')}>{d < 0 ? '−' : '+'}{nf.format(Math.abs(d))}</span>}
                      <span class="sf-row__end"><b style="color:var(--ink)">{nf.format(lastOf(f)!)}</b> {t('unit.cm')}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {withPhotos.length > 0 && (
              <>
                <div class="screen__row">
                  <h2 class="sf-section">{t('measures.photos')}</h2>
                  {withPhotos.length > 1 && <Button variant="ghost" onClick={() => setCompare(true)}>{t('measures.compare')}</Button>}
                </div>
                <div class="photo-grid">
                  {[...withPhotos].reverse().flatMap((m) => (m.photos ?? []).map((id) => (
                    <button type="button" class="photo-tile sf-press" onClick={() => setEdit(m)}>
                      <PhotoImg id={id} store={store} />
                      <span>{df.format(fromDateKey(m.date))}</span>
                    </button>
                  )))}
                </div>
              </>
            )}

            <h2 class="sf-section">{t('measures.history')}</h2>
            <div class="sf-list">
              {[...list].reverse().map((m) => (
                <button type="button" class="sf-row sf-row--tall" onClick={() => setEdit(m)}>
                  <span class="sf-row__main">
                    <span class="sf-row__title">{new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'long', year: 'numeric' }).format(fromDateKey(m.date))}</span>
                    <span class="sf-row__sub">
                      {MEASURE_FIELDS.filter((f) => m[f] !== undefined).map((f) => `${t('field.' + f + '.short')} ${nf.format(m[f]!)}`).join(' · ')}
                      {m.photos?.length ? <> · <Icon name="camera" size={14} /> {m.photos.length}</> : ''}
                    </span>
                  </span>
                  <Icon name="chevron-right" size={20} class="sf-row__chev" />
                </button>
              ))}
            </div>
          </>
        )}
      </main>
      <div class="save-bar"><Button block icon="plus" onClick={() => setEdit('new')}>{t('measures.add')}</Button></div>
      <TabBar active="measures" dot={{ measures: due }} />

      {edit && (
        <MeasureSheet
          initial={edit === 'new' ? list.find((m) => m.date === today) : edit} list={list} store={store}
          onSave={save} onClose={() => setEdit(null)}
        />
      )}
      {compare && <CompareSheet list={withPhotos} store={store} onClose={() => setCompare(false)} />}
    </>
  );
}

/** Weight over time: a calm line with the first and last points marked. */
function WeightChart({ list }: { list: Measure[] }) {
  const t = useT();
  const lang = useLang();
  const pts = list.filter((m) => m.weight !== undefined).slice(-60);
  const W = 320, H = 120, P = 10;
  const xs = pts.map((m) => fromDateKey(m.date).getTime());
  const ys = pts.map((m) => m.weight!);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys) - 0.5, Math.max(...ys) + 0.5];
  const X = (x: number) => P + ((x - x0) / Math.max(1, x1 - x0)) * (W - 2 * P);
  const Y = (y: number) => P + (1 - (y - y0) / Math.max(0.1, y1 - y0)) * (H - 2 * P);
  const d = pts.map((_, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(ys[i]).toFixed(1)}`).join(' ');
  const nf = new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 1 });
  return (
    <div class="sf-card chart">
      <div class="screen__row"><h2 class="sf-label">{t('measures.chart')}</h2><span class="sf-meta">{nf.format(y0 + 0.5)}–{nf.format(y1 - 0.5)} {t('unit.kg')}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={t('measures.chart')}>
        <path d={`${d} L${X(x1)},${H} L${X(x0)},${H} Z`} class="chart__area" />
        <path d={d} class="chart__line" />
        {pts.map((_, i) => <circle cx={X(xs[i])} cy={Y(ys[i])} r={i === pts.length - 1 ? 4.5 : 2.5} class={i === pts.length - 1 ? 'chart__last' : 'chart__dot'} />)}
      </svg>
    </div>
  );
}

function usePhotoUrl(id: string, store: TiloDB): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let u: string | undefined;
    let alive = true;
    void store.photos.get(id).then((p) => {
      if (!alive || !p) return;
      u = URL.createObjectURL(p.blob);
      setUrl(u);
    });
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [id, store]);
  return url;
}

export function PhotoImg({ id, store }: { id: string; store: TiloDB }) {
  const url = usePhotoUrl(id, store);
  return url ? <img src={url} alt="" decoding="async" /> : <span class="photo-ph"><Icon name="camera" /></span>;
}

/** Downscale to ≤1280 px JPEG: keeps photos small enough for the phone and the data repo. */
async function resize(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', 0.82));
}

function MeasureSheet({ initial, list, store, onSave, onClose }: {
  initial?: Measure; list: Measure[]; store: TiloDB; onSave: (m: Measure) => Promise<void>; onClose: () => void;
}) {
  const t = useT();
  const today = todayKey();
  const [date, setDate] = useState(initial?.date ?? today);
  const existing = useMemo(() => list.find((m) => m.date === date), [list, date]);
  const [vals, setVals] = useState<Partial<Record<MeasureField, string>>>(() => toText(initial));
  const [photos, setPhotos] = useState<string[]>(initial?.photos ?? []);
  const [fresh, setFresh] = useState<{ id: string; blob: Blob }[]>([]);
  const [busy, setBusy] = useState(false);
  // Changing the date loads that day's measurement, if any.
  useEffect(() => {
    if (existing && existing.date !== initial?.date) { setVals(toText(existing)); setPhotos(existing.photos ?? []); }
  }, [existing]);

  const parsed = Object.fromEntries(MEASURE_FIELDS.map((f) => [f, num(vals[f])])) as Record<MeasureField, number | undefined>;
  const valid = MEASURE_FIELDS.some((f) => parsed[f] !== undefined) || photos.length > 0;

  const addPhotos = async (files: FileList) => {
    setBusy(true);
    try {
      const added = await Promise.all([...files].slice(0, 12 - photos.length).map(async (f) => ({ id: `${date}-${newId()}`, blob: await resize(f) })));
      setFresh((x) => [...x, ...added]);
      setPhotos((p) => [...p, ...added.map((a) => a.id)]);
      sound('chipOn');
    } finally {
      setBusy(false);
    }
  };

  const submit = async (close: () => void) => {
    setBusy(true);
    for (const p of fresh) if (photos.includes(p.id)) await putPhoto({ id: p.id, date, blob: p.blob }, store);
    const now = nowIso();
    const m: Measure = { schemaVersion: SCHEMA_VERSION, date, createdAt: existing?.createdAt ?? now, updatedAt: now };
    for (const f of MEASURE_FIELDS) if (parsed[f] !== undefined) m[f] = parsed[f];
    if (photos.length) m.photos = photos;
    await onSave(m);
    sound('saved');
    close();
  };

  return (
    <Sheet onClose={onClose} labelledBy="measure-title">
      {(close) => (<>
        <div class="sf-sheet__head">
          <span class="sf-dchip sf-dchip--lg" style="background:var(--accent-soft);color:var(--accent-ink)"><Icon name="measures" size={22} /></span>
          <h2 class="sf-h2" id="measure-title" style="flex:1">{existing ? t('measures.editTitle') : t('measures.add')}</h2>
          <IconButton icon="close" label={t('common.close')} tone="sunk" size={22} onClick={close} />
        </div>
        <div class="sf-field">
          <label class="sf-field__label" for="m-date">{t('measures.date')}</label>
          <input id="m-date" type="date" class="sf-input sf-input--ui" max={today} value={date} onInput={(e) => setDate((e.currentTarget as HTMLInputElement).value || today)} />
        </div>
        <div class="measure-fields">
          {MEASURE_FIELDS.map((f) => (
            <label class={'measure-field' + (f === 'weight' ? ' is-wide' : '')}>
              <span>{t('field.' + f)}</span>
              <span class="measure-field__in">
                <input class="sf-input sf-input--ui" inputMode="decimal" enterKeyHint="next" placeholder="—" value={vals[f] ?? ''}
                  onInput={(e) => setVals((v) => ({ ...v, [f]: (e.currentTarget as HTMLInputElement).value }))} />
                <i>{t(f === 'weight' ? 'unit.kg' : 'unit.cm')}</i>
              </span>
            </label>
          ))}
        </div>
        <div class="stack">
          <span class="sf-label">{t('measures.photos')}</span>
          <div class="photo-grid">
            {photos.map((id) => {
              const f = fresh.find((p) => p.id === id);
              return (
                <span class="photo-tile">
                  {f ? <BlobImg blob={f.blob} /> : <PhotoImg id={id} store={store} />}
                  <button type="button" class="photo-tile__x" aria-label={t('measures.removePhoto')} onClick={() => { sound('clear'); setPhotos((p) => p.filter((x) => x !== id)); }}>
                    <Icon name="close" size={16} />
                  </button>
                </span>
              );
            })}
            {photos.length < 12 && (
              <label class="photo-tile photo-add sf-press">
                <Icon name="camera" />
                <span>{t('measures.addPhoto')}</span>
                <input type="file" accept="image/*" multiple hidden onChange={(e) => { const fl = (e.currentTarget as HTMLInputElement).files; if (fl?.length) void addPhotos(fl); (e.currentTarget as HTMLInputElement).value = ''; }} />
              </label>
            )}
          </div>
          <p class="sf-meta">{t('measures.photoHint')}</p>
        </div>
        <Button block icon="check" disabled={!valid || busy} onClick={() => void submit(close)}>{t('common.save')}</Button>
      </>)}
    </Sheet>
  );
}

function BlobImg({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url ? <img src={url} alt="" /> : null;
}

function CompareSheet({ list, store, onClose }: { list: Measure[]; store: TiloDB; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const [a, setA] = useState(list[0].date);
  const [b, setB] = useState(list[list.length - 1].date);
  const df = new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'short', year: 'numeric' });
  const nf = new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 1 });
  const side = (date: string, set: (d: string) => void) => {
    const m = list.find((x) => x.date === date)!;
    return (
      <div class="compare__side">
        <span class="photo-tile compare__img"><PhotoImg id={m.photos![0]} store={store} /></span>
        <select class="sf-input sf-input--ui" value={date} onChange={(e) => set((e.currentTarget as HTMLSelectElement).value)} aria-label={t('measures.date')}>
          {list.map((x) => <option value={x.date}>{df.format(fromDateKey(x.date))}</option>)}
        </select>
        <span class="sf-meta">{m.weight ? `${nf.format(m.weight)} ${t('unit.kg')}` : ''}{m.waist ? ` · ${t('field.waist.short')} ${nf.format(m.waist)}` : ''}</span>
      </div>
    );
  };
  return (
    <Sheet onClose={onClose} labelledBy="compare-title">
      {(close) => (<>
        <div class="sf-sheet__head">
          <h2 class="sf-h2" id="compare-title" style="flex:1">{t('measures.compare')}</h2>
          <IconButton icon="close" label={t('common.close')} tone="sunk" size={22} onClick={close} />
        </div>
        <div class="compare">{side(a, setA)}{side(b, setB)}</div>
      </>)}
    </Sheet>
  );
}

function toText(m?: Measure): Partial<Record<MeasureField, string>> {
  if (!m) return {};
  return Object.fromEntries(MEASURE_FIELDS.filter((f) => m[f] !== undefined).map((f) => [f, String(m[f])]));
}

function num(s?: string): number | undefined {
  if (!s) return undefined;
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : undefined;
}
