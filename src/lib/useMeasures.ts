import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Measure } from '../model/types';
import { allMeasures, db, putMeasure } from '../storage/db';
import { schedulePush } from '../storage/sync';
import { recomputeGoals } from '../storage/goals';

export function useMeasures() {
  const [list, setList] = useState<Measure[]>([]);
  const [loaded, setLoaded] = useState(false);
  const store = useRef(db).current;
  const load = useCallback(() => void allMeasures(store).then((m) => { setList(m); setLoaded(true); }), [store]);
  useEffect(() => {
    load();
    window.addEventListener('tilo:synced', load);
    return () => window.removeEventListener('tilo:synced', load);
  }, [load]);
  const save = useCallback(async (m: Measure) => {
    await putMeasure(m, store);
    // A new weight moves automatic targets.
    if (await recomputeGoals(store)) window.dispatchEvent(new CustomEvent('tilo:plan'));
    load();
    schedulePush();
  }, [store, load]);
  return { list, loaded, save, store };
}

/** Latest value of each field, and the first weight ever logged (the start line). */
export function measureStats(list: Measure[]) {
  const weights = list.filter((m) => m.weight !== undefined);
  const first = weights[0];
  const last = weights[weights.length - 1];
  return { first, last, delta: first && last ? Math.round((last.weight! - first.weight!) * 10) / 10 : undefined, lastDate: list[list.length - 1]?.date };
}
