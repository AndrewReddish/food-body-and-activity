import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { DateKey, DayLog } from '../model/types';
import { SCHEMA_VERSION } from '../model/schema';
import { db, getDay, getPlan, putDay } from '../storage/db';
import { schedulePush } from '../storage/sync';
import { nowIso, todayKey } from './dates';

export type DayDraft = Pick<DayLog, 'food'> & Partial<Pick<DayLog, 'steps' | 'cups' | 'soda'>>;

const SAVE_DELAY_MS = 400;
const empty = (): DayDraft => ({ food: [] });
const isEmpty = (d: DayDraft) => !d.food.length && d.steps === undefined && d.cups === undefined && d.soda === undefined;

/** Load, edit and auto-save one day. Local first; sync is scheduled after. */
export function useDay(date: DateKey) {
  const [day, setDay] = useState<DayDraft>(empty);
  const [loaded, setLoaded] = useState(false);
  const pending = useRef<ReturnType<typeof setTimeout>>();
  const latest = useRef<DayDraft>(empty());
  // Pin this user's database: a save that fires after a user switch must stay with its owner.
  const store = useRef(db).current;

  const reload = useCallback(async () => {
    const e = await getDay(date, store);
    const d: DayDraft = e ? { food: e.food, steps: e.steps, cups: e.cups, soda: e.soda } : empty();
    latest.current = d;
    setDay(d);
    setLoaded(true);
  }, [date, store]);

  useEffect(() => {
    setLoaded(false);
    void reload();
    const onSync = () => {
      if (!pending.current) void reload();
    };
    window.addEventListener('tilo:synced', onSync);
    return () => window.removeEventListener('tilo:synced', onSync);
  }, [reload]);

  const persist = useCallback(async () => {
    pending.current = undefined;
    const d = latest.current;
    const prev = await getDay(date, store);
    if (!prev && isEmpty(d)) return;
    const now = nowIso();
    const out: DayLog = { schemaVersion: SCHEMA_VERSION, date, food: d.food, createdAt: prev?.createdAt ?? now, updatedAt: now };
    if (d.steps !== undefined) out.steps = d.steps;
    if (d.cups !== undefined) out.cups = d.cups;
    if (d.soda !== undefined) out.soda = d.soda;
    // Today takes the current goals; a past day keeps the ones it was saved with (or gets today's, if none).
    const plan = await getPlan(store);
    const current = { kcal: plan.kcalTarget, protein: Math.round(plan.macros?.protein ?? 0), steps: plan.stepsGoal };
    out.targets = date === todayKey() ? current : prev?.targets ?? current;
    await putDay(out, store);
    schedulePush();
  }, [date, store]);

  const update = useCallback(
    (patch: Partial<DayDraft> | ((d: DayDraft) => DayDraft)) => {
      const next = typeof patch === 'function' ? patch(latest.current) : { ...latest.current, ...patch };
      latest.current = next;
      setDay(next);
      clearTimeout(pending.current);
      pending.current = setTimeout(() => void persist(), SAVE_DELAY_MS);
    },
    [persist],
  );

  useEffect(() => () => {
    if (pending.current) {
      clearTimeout(pending.current);
      void persist();
    }
  }, [persist]);

  return { day, loaded, update };
}
