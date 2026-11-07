import type { Plan } from '../model/types';
import { applyTargets, cleanFormula, type Body, type Formula } from '../model/targets';
import { nowIso } from '../lib/dates';
import { db, getPlan, putPlan, allMeasures } from './db';

/** The owner's formula coefficients, as last pulled from the `formula` table (device-local cache). */
export async function getFormula(d = db): Promise<Formula> {
  const row = await d.kv.get('formula');
  return cleanFormula(row?.value as Partial<Formula> | undefined);
}

export async function putFormula(f: Formula, d = db): Promise<void> {
  await d.kv.put({ key: 'formula', value: f });
}

/** The newest measured weight, kg. */
export async function latestWeight(d = db): Promise<number | undefined> {
  const list = await allMeasures(d);
  for (let i = list.length - 1; i >= 0; i--) if (list[i].weight !== undefined) return list[i].weight;
  return undefined;
}

/**
 * A goals stamp that is newer than the current one even when this phone's clock is behind the server's
 * (an owner edit is stamped with server time): otherwise a recalculation would lose to the edit it follows.
 */
export function goalsStamp(plan: Plan): string {
  const now = Date.now();
  const prev = plan.goalsUpdatedAt ? Date.parse(plan.goalsUpdatedAt) : 0;
  return new Date(Math.max(now, prev + 1)).toISOString();
}

/**
 * Re-derive kcal / protein / steps / macros from the body when the person is on automatic targets.
 * Saves (and marks the plan for upload) only when a value actually changed. Returns whether it did.
 */
export async function recomputeGoals(d = db): Promise<boolean> {
  const plan = await getPlan(d);
  const next = applyTargets(plan, await latestWeight(d), await getFormula(d), goalsStamp(plan));
  if (next === plan) return false;
  await putPlan({ ...next, updatedAt: nowIso() }, {}, d);
  return true;
}

/** Body fields, without empty ones, so two copies compare equal however they were stored. */
export function normBody(b: Partial<Record<keyof Body, unknown>> | undefined): Body | undefined {
  if (!b) return undefined;
  // auto off and a zero adjustment are the same as not set (the table's defaults).
  const empty = (k: string, v: unknown) => v === undefined || v === null || v === '' || (k === 'auto' && v === false) || (k === 'kcalAdjust' && v === 0);
  const out = Object.fromEntries(Object.entries(b).filter(([k, v]) => !empty(k, v))) as Body;
  return Object.keys(out).length ? out : undefined;
}

export const sameBody = (a: Body | undefined, b: Body | undefined) => {
  const x = normBody(a), y = normBody(b);
  const keys = new Set([...Object.keys(x ?? {}), ...Object.keys(y ?? {})]) as Set<keyof Body>;
  return [...keys].every((k) => x?.[k] === y?.[k]);
};
