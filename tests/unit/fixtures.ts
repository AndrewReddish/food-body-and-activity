import type { DayLog, Measure } from '../../src/model/types';
import { defaultPlan } from '../../src/model/defaults';
import { makeLog } from '../../src/model/cooking';

export const plan = defaultPlan();
export const item = (id: string) => plan.items.find((i) => i.id === id)!;
export const group = (id: string) => plan.groups.find((g) => g.id === id)!;

export function log(itemId: string, weighed: number, method: 'raw' | 'boiled' | 'baked' | 'fried' = 'raw', id = itemId + weighed) {
  const i = item(itemId);
  return makeLog(i, group(i.group), method, weighed, id, '2026-11-02T13:00:00+02:00');
}

export function day(date: string, updatedAt: string, patch: Partial<DayLog> = {}): DayLog {
  return { schemaVersion: 1, date, food: [], createdAt: updatedAt, updatedAt, ...patch };
}

export function measure(date: string, updatedAt: string, patch: Partial<Measure> = {}): Measure {
  return { schemaVersion: 1, date, createdAt: updatedAt, updatedAt, ...patch };
}
