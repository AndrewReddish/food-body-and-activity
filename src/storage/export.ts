import { z } from 'zod';
import type { DayLog, Measure, Plan } from '../model/types';
import { DayLogSchema, MeasureSchema, PlanSchema, SCHEMA_VERSION } from '../model/schema';

export const BackupSchema = z.object({
  app: z.literal('tilo'),
  schemaVersion: z.literal(SCHEMA_VERSION),
  exportedAt: z.string(),
  plan: PlanSchema,
  days: z.array(DayLogSchema),
  measures: z.array(MeasureSchema),
});
export type Backup = z.infer<typeof BackupSchema>;

export function toBackup(plan: Plan, days: DayLog[], measures: Measure[], exportedAt: string): Backup {
  return { app: 'tilo', schemaVersion: SCHEMA_VERSION, exportedAt, plan, days, measures };
}

export function parseBackup(json: string): Backup {
  return BackupSchema.parse(JSON.parse(json));
}

function csvCell(v: unknown): string {
  if (v === undefined || v === null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const csv = (rows: unknown[][]) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/** One row per day: kcal, protein, use of each group (%), steps, cups, soda, weight. Empty = not logged. */
export function toCsv(days: DayLog[], measures: Measure[], plan: Plan): string {
  const groups = [...plan.groups].sort((a, b) => a.order - b.order);
  const byDate = new Map(measures.map((m) => [m.date, m]));
  const dates = [...new Set([...days.map((d) => d.date), ...measures.map((m) => m.date)])].sort();
  const dayMap = new Map(days.map((d) => [d.date, d]));
  const header = ['date', 'kcal', 'protein', ...groups.map((g) => `${g.letter}%`), 'steps', 'cups', 'soda_ml', 'weight', 'waist', 'hips', 'chest', 'arm', 'thigh'];
  const rows = dates.map((date) => {
    const d = dayMap.get(date);
    const m = byDate.get(date);
    const use: Record<string, number> = {};
    for (const f of d?.food ?? []) use[f.group] = (use[f.group] ?? 0) + f.frac;
    return [
      date,
      d?.food.length ? Math.round(d.food.reduce((s, f) => s + f.kcal, 0)) : undefined,
      d?.food.length ? Math.round(d.food.reduce((s, f) => s + f.protein, 0) * 10) / 10 : undefined,
      ...groups.map((g) => (use[g.id] !== undefined ? Math.round(use[g.id] * 100) : undefined)),
      d?.steps, d?.cups, d?.soda, m?.weight, m?.waist, m?.hips, m?.chest, m?.arm, m?.thigh,
    ];
  });
  return csv([header, ...rows]);
}

/** Every food row, for anyone who wants the detail. */
export function foodCsv(days: DayLog[], plan: Plan): string {
  const names = new Map(plan.items.map((i) => [i.id, i.nameUk]));
  const header = ['date', 'time', 'group', 'item', 'method', 'weighed', 'raw', 'share%', 'kcal', 'protein'];
  const rows = days.flatMap((d) => d.food.map((f) => [
    d.date, f.at.slice(11, 16), plan.groups.find((g) => g.id === f.group)?.letter ?? f.group,
    names.get(f.item) ?? f.item, f.method, f.weighed, f.raw, Math.round(f.frac * 100), f.kcal, f.protein,
  ]));
  return csv([header, ...rows]);
}

/** Share sheet on iOS; download fallback elsewhere. */
export async function shareFile(name: string, mime: string, content: string): Promise<void> {
  const file = new File([content], name, { type: mime });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
