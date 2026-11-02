import type { Plan } from '../model/types';
import { compareIso } from '../lib/dates';

type Stamped = { updatedAt: string };

/** Newer `updatedAt` wins; ties keep the local copy (no needless push). */
export function pickNewer<T extends Stamped>(local: T | undefined, remote: T | undefined): T | undefined {
  if (!local) return remote;
  if (!remote) return local;
  return compareIso(remote.updatedAt, local.updatedAt) > 0 ? remote : local;
}

/** Merge two keyed maps record-by-record (per day / per measurement date). */
export function mergeMaps<T extends Stamped>(local: Record<string, T>, remote: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const v = pickNewer(local[key], remote[key]);
    if (v) out[key] = v;
  }
  return out;
}

export const mergePlan = (l: Plan, r: Plan | undefined): Plan => pickNewer(l, r)!;

/** True when `merged` differs from `side` — i.e. that side needs updating. */
export function differs<T extends Stamped>(merged: Record<string, T>, side: Record<string, T>): boolean {
  const keys = Object.keys(merged);
  if (keys.length !== Object.keys(side).length) return true;
  return keys.some((k) => !side[k] || side[k].updatedAt !== merged[k].updatedAt);
}
