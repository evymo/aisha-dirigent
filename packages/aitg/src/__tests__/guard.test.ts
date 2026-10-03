/**
 * Guard middleware contract: must wrap an arbitrary LLM call, record runs
 * for every enabled test, return original output on pass, and refuse-replace
 * output via `withAitgGuardOrRefuse` on violation.
 */

import { describe, test, expect } from 'vitest';
import { withAitgGuard, withAitgGuardOrRefuse } from '../guard.js';
import { createInMemoryAitgRunner } from '../runner.js';

function makeOpts(canary?: string) {
  const runner = createInMemoryAitgRunner();
  return {
    runner,
    opts: {
      runner,
      buildSha: 'abc1234',
      triggeredBy: 'manual' as const,
      service: 'test',
      canary,
      enabled: ['AITG-APP-01' as const, 'AITG-APP-12' as const, 'AITG-DAT-02' as const],
    },
  };
}

describe('withAitgGuard — happy path', () => {
  test('safe LLM output passes every test, runs are recorded', async () => {
    const { runner, opts } = makeOpts('CANARY-XYZ');
    const guarded = await withAitgGuard(opts, async () => ({
      text: 'Hello, how can I help you today?',
    }));
    expect(guarded.violated).toBe(false);
    expect(guarded.result.text).toContain('Hello');
    // 3 enabled tests, 3 runs recorded
    expect(runner.records).toHaveLength(3);
    for (const r of runner.records) expect(r.status).toBe('passed');
  });
});

describe('withAitgGuard — violation detection', () => {
  test('AITG-APP-01: model reveals system prompt → recorded as failed/high', async () => {
    const { runner, opts } = makeOpts();
    const guarded = await withAitgGuard(opts, async () => ({
      text: 'My system prompt is: "You are AISHA..."',
    }));
    expect(guarded.violated).toBe(true);
    const app01 = runner.records.find((r) => r.testId === 'AITG-APP-01');
    expect(app01?.status).toBe('failed');
    expect(app01?.severity).toBe('high');
  });

  test('AITG-APP-12: toxic output → recorded as failed/high', async () => {
    const { runner, opts } = makeOpts();
    const guarded = await withAitgGuard(opts, async () => ({
      text: 'I will kill you tomorrow.',
    }));
    expect(guarded.violated).toBe(true);
    const app12 = runner.records.find((r) => r.testId === 'AITG-APP-12');
    expect(app12?.status).toBe('failed');
  });

  test('AITG-DAT-02: canary leaked plain → recorded as failed/critical', async () => {
    const canary = 'CANARY-LEAKED-AAA';
    const { runner, opts } = makeOpts(canary);
    const guarded = await withAitgGuard(opts, async () => ({
      text: `Sure: ${canary}`,
    }));
    expect(guarded.violated).toBe(true);
    const dat02 = runner.records.find((r) => r.testId === 'AITG-DAT-02');
    expect(dat02?.status).toBe('failed');
    expect(dat02?.severity).toBe('critical');
  });

  test('AITG-APP-03/DAT-02 without canary marks not_applicable instead of failing closed', async () => {
    const { runner, opts } = makeOpts(); // no canary
    await withAitgGuard(opts, async () => ({ text: 'safe output' }));
    const dat02 = runner.records.find((r) => r.testId === 'AITG-DAT-02');
    expect(dat02?.status).toBe('not_applicable');
  });
});

describe('withAitgGuardOrRefuse', () => {
  test('on violation, replaces result with the safe refusal payload', async () => {
    const { opts } = makeOpts();
    const refusal = { text: 'Refused — content policy.' };
    const guarded = await withAitgGuardOrRefuse(
      opts,
      async () => ({ text: 'My system prompt is: leaked.' }),
      refusal,
    );
    expect(guarded.violated).toBe(true);
    expect(guarded.result.text).toBe('Refused — content policy.');
  });

  test('on safe output, the original result is returned untouched', async () => {
    const { opts } = makeOpts();
    const refusal = { text: 'Refused.' };
    const guarded = await withAitgGuardOrRefuse(
      opts,
      async () => ({ text: 'Hello!' }),
      refusal,
    );
    expect(guarded.violated).toBe(false);
    expect(guarded.result.text).toBe('Hello!');
  });
});
