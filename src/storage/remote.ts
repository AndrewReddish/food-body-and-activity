import type { Body, Formula } from '../model/targets';
/**
 * The remote side of sync, kept behind a small interface so the merge logic (sync-remote.ts) can be
 * unit-tested against an in-memory store. The real implementation is Supabase (supabase.ts).
 *
 * Every row belongs to the signed-in account and one app user (`profile`). The server keeps the newer
 * `updatedAt` on conflicting writes and stamps each accepted write with a server time (`syncedAt`),
 * which drives incremental pulls.
 */
export type RecordKind = 'days' | 'measures';

export interface RemoteRow {
  /** Record payload exactly as the app stores it (validated with Zod on the way back in). */
  data: unknown;
  /** Server time of the last accepted write. */
  syncedAt: string;
}

export interface RemoteChanges {
  days: RemoteRow[];
  measures: RemoteRow[];
  plan?: RemoteRow;
}

export interface RemoteProfile {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

/** Daily goals as plain columns (Supabase `goals` table), editable by the owner in the dashboard. */
export interface RemoteGoals {
  kcal: number;
  protein: number;
  steps: number;
  /**
   * Body data and weight goal (plan.body): sex, birth year, height, start weight, activity, goal, auto …
   * null: the table has the body columns, all empty. Absent: the table has no body columns (migration 0003
   * not run), so the server says nothing about the body and the app's copy must be kept.
   */
  body?: Body | null;
  updatedAt: string;
}

export interface RemoteStore {
  /** Upsert records keyed by `date`; rows the server already has a newer version of are left alone. */
  putRecords(kind: RecordKind, profile: string, rows: { date: string; updatedAt: string; data: unknown }[]): Promise<void>;
  putPlan(profile: string, plan: { updatedAt: string }): Promise<void>;
  /** Everything for this user written at or after `since` (all of it when `since` is undefined). */
  changesSince(profile: string, since?: string): Promise<RemoteChanges>;
  /** Photos are immutable: uploading one that already exists is not an error. */
  putPhoto(profile: string, id: string, blob: Blob): Promise<void>;
  getPhoto(profile: string, id: string): Promise<Blob | undefined>;
  listProfiles(): Promise<RemoteProfile[]>;
  putProfiles(profiles: RemoteProfile[]): Promise<void>;
  /** undefined: no row yet, or the goals table doesn't exist (migration 0002 not run). */
  getGoals(profile: string): Promise<RemoteGoals | undefined>;
  /** The server keeps the newer `updatedAt`. A no-op when the goals table doesn't exist. */
  putGoals(profile: string, goals: RemoteGoals): Promise<void>;
  /** The owner's formula coefficients (`formula` table); undefined when there is none (migration 0003 not run). */
  getFormula(): Promise<Partial<Formula> | undefined>;
}

export class RemoteError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) {
    super(message);
  }
}
