import { describe, expect, it } from 'vitest';
import { foodCsv, parseBackup, toBackup, toCsv } from '../../src/storage/export';
import { day, log, measure, plan } from './fixtures';

describe('export', () => {
  const days = [day('2026-11-02', '2026-11-02T21:00:00+02:00', { food: [log('veal', 200, 'fried'), log('oil', 10)], steps: 8000 })];
  const measures = [measure('2026-11-02', '2026-11-02T08:00:00+02:00', { weight: 103.4 }), measure('2026-11-01', 'x', { waist: 101 })];

  it('daily CSV: one row per date, group shares in %, blanks for not logged', () => {
    const lines = toCsv(days, measures, plan).replace('﻿', '').trim().split('\r\n');
    expect(lines[0]).toBe('date,kcal,protein,а%,б%,в%,г%,д%,е%,є%,ж%,steps,cups,soda_ml,weight,waist,hips,chest,arm,thigh');
    expect(lines[1]).toBe('2026-11-01,,,,,,,,,,,,,,,101,,,,');
    expect(lines[2].startsWith('2026-11-02,579,')).toBe(true);
    expect(lines[2]).toContain(',94,,50,');
  });

  it('food CSV lists every entry with raw and weighed amounts', () => {
    const lines = foodCsv(days, plan).replace('﻿', '').trim().split('\r\n');
    expect(lines[1]).toBe('2026-11-02,13:00,б,Телятина,fried,200,285.7,94,489,57.1');
  });

  it('backup round-trips', () => {
    const b = toBackup(plan, days, measures.slice(0, 1), '2026-11-02T22:00:00+02:00');
    expect(parseBackup(JSON.stringify(b))).toEqual(b);
  });
});
