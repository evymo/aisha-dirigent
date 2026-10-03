import { describe, it, expect } from 'vitest';
import { validateClaudeResult, buildRunOutputs } from '../backends/claude-result.js';

describe('validateClaudeResult — the CLI result-format contract', () => {
  it('accepts a well-formed sentinel value', () => {
    const v = validateClaudeResult({ ok: true, run_id: 'r1', exit_code: 0 });
    expect(v.valid).toBe(true);
    expect(v.value).toEqual({ ok: true, run_id: 'r1', exit_code: 0 });
    expect(v.reason).toBeNull();
  });

  it('rejects a missing sentinel (exited 0 with no __result line)', () => {
    for (const raw of [undefined, null]) {
      const v = validateClaudeResult(raw);
      expect(v.valid).toBe(false);
      expect(v.value).toBeNull();
      expect(v.reason).toMatch(/no __result sentinel/);
    }
  });

  it('rejects a non-object sentinel', () => {
    const v = validateClaudeResult('garbage');
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/not an object/);
  });

  it('rejects a structurally-incomplete sentinel (missing/mistyped fields)', () => {
    for (const raw of [
      { ok: true },                                   // missing run_id + exit_code
      { ok: true, run_id: 'r1' },                      // missing exit_code
      { ok: 'yes', run_id: 'r1', exit_code: 0 },       // ok mistyped
      { ok: true, run_id: 1, exit_code: 0 },           // run_id mistyped
      { ok: true, run_id: 'r1', exit_code: '0' },      // exit_code mistyped
    ]) {
      const v = validateClaudeResult(raw);
      expect(v.valid).toBe(false);
      expect(v.reason).toMatch(/missing\/mistyped/);
    }
  });
});

describe('buildRunOutputs — the persisted agent_runs.outputs payload', () => {
  it('carries the validated result, the valid flag, and a bounded log tail', () => {
    const v = validateClaudeResult({ ok: true, run_id: 'r1', exit_code: 0 });
    const logs = Array.from({ length: 120 }, (_, i) => ({ level: 'info', message: `line ${i}` }));
    const out = buildRunOutputs(v, logs, 50);
    expect(out.result).toEqual({ ok: true, run_id: 'r1', exit_code: 0 });
    expect(out.result_valid).toBe(true);
    expect(out.result_error).toBeUndefined();
    expect((out.logs as unknown[]).length).toBe(50);
    expect((out.logs as Array<{ message: string }>)[0].message).toBe('line 70'); // tail, not head
  });

  it('carries the failure reason when the sentinel is invalid', () => {
    const v = validateClaudeResult(undefined);
    const out = buildRunOutputs(v, []);
    expect(out.result).toBeNull();
    expect(out.result_valid).toBe(false);
    expect(out.result_error).toMatch(/no __result sentinel/);
  });
});
