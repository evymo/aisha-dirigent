/**
 * Obálka `__result` z plugin-exec: runner předá i deklarace rozvrhů.
 * ⛔ 2026-09-16: obě kopie parseLogs (docker, kata) vzaly jen `value` a `schedules`
 * zahodily — host se o rozvrhu pluginu nedozvěděl a cron capability nikdy neběžela.
 */
import { describe, expect, it } from 'vitest';
import { parseSentinelLogs } from '../backends/sentinel.js';

describe('parseSentinelLogs', () => {
  it('vydá value i schedules z obálky', () => {
    const raw = [
      JSON.stringify({ level: 'info', message: 'init' }),
      JSON.stringify({ __result: true, value: { ok: 1 }, schedules: [{ cron: '*/5 * * * *', capability: 'cron.poll' }] }),
    ].join('\n');
    const r = parseSentinelLogs(raw);
    expect(r.result).toEqual({ ok: 1 });
    expect(r.schedules).toEqual([{ cron: '*/5 * * * *', capability: 'cron.poll' }]);
    expect(r.logs).toEqual([{ level: 'info', message: 'init', meta: undefined }]);
  });

  it('starý tvar deklarace (bez capability) se nezahodí — host ho odmítne nahlas', () => {
    const r = parseSentinelLogs(JSON.stringify({ __result: true, value: null, schedules: [{ cron: '0 2 * * *' }] }));
    expect(r.schedules).toEqual([{ cron: '0 2 * * *', capability: null }]);
  });

  it('bez obálky / bez schedules → prázdný seznam, nečitelný řádek jde do logu', () => {
    const r = parseSentinelLogs('nejaky text\n' + JSON.stringify({ __result: true, value: 3 }));
    expect(r.schedules).toEqual([]);
    expect(r.result).toBe(3);
    expect(r.logs).toEqual([{ level: 'info', message: 'nejaky text' }]);
  });
});
