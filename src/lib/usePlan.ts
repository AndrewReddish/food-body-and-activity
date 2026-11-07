import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Plan } from '../model/types';
import { defaultPlan } from '../model/defaults';
import { db, getPlan, putPlan } from '../storage/db';
import { schedulePush } from '../storage/sync';
import { nowIso } from './dates';
import { scalePlan } from '../model/scale';

export function usePlan() {
  const [plan, setPlan] = useState<Plan>(defaultPlan);
  const store = useRef(db).current;
  useEffect(() => {
    const load = () => void getPlan(store).then(setPlan);
    load();
    window.addEventListener('tilo:synced', load);
    window.addEventListener('tilo:plan', load);
    return () => {
      window.removeEventListener('tilo:synced', load);
      window.removeEventListener('tilo:plan', load);
    };
  }, [store]);

  const save = useCallback(async (next: Plan) => {
    const stamped = { ...next, updatedAt: nowIso() };
    await putPlan(stamped, {}, store);
    setPlan(stamped);
    window.dispatchEvent(new CustomEvent('tilo:plan'));
    schedulePush();
  }, [store]);

  /** What the screens use: amounts scaled to this person's calorie goal. Edit and save `base`, never this. */
  const scaled = useMemo(() => scalePlan(plan), [plan]);
  const groups = [...scaled.groups].sort((a, b) => a.order - b.order);
  const items = [...scaled.items].sort((a, b) => a.order - b.order);
  return { plan: scaled, base: plan, groups, items, save };
}
