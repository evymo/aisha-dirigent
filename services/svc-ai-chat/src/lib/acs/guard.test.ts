/**
 * Unit tests for the ACS effect guard (guard.ts, IP-8).
 *
 * Locks the two invariants that matter for safety:
 *   - ACS_MODE=off is a bit-for-bit passthrough (No Regressions): runExecution
 *     runs, and neither the SDK nor postgrest is touched.
 *   - ACS_MODE=enforce is fail-CLOSED: when the readback trail cannot be
 *     persisted (acs_effect_propose/decide throws — e.g. the F4 intent anchor is
 *     not wired yet, or the DB is unreachable), the effect is ABORTED and the
 *     underlying tool NEVER runs. This is the regression the review flagged: the
 *     persistence error used to be swallowed and executeGuarded ran anyway.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockRpcService = vi.fn();
vi.mock('../../postgrest.js', () => ({ rpcService: mockRpcService }));

const mockExecuteGuarded = vi.fn();
vi.mock('@aisha/acs-sdk', () => ({
  buildProposal: (input: { toolName: string }) => ({
    effect_id: 'eff_00000000000000000000000001',
    tool_name: input.toolName,
    proposal: { params_sha256: 'a'.repeat(64) },
  }),
  decideProposal: () => ({ decision: 'confirm', reason_code: null, params_sha256: 'a'.repeat(64) }),
  executeGuarded: mockExecuteGuarded,
}));

import { acsGuardToolExecution, resetAcsGuardCache } from './guard.js';

const CALL = { id: 'call-1', name: 'demo_write', arguments: { x: 1 } };
const okResult = { toolCallId: 'call-1', content: '{"ok":true}', ok: true, durationMs: 5 };

beforeEach(() => {
  mockRpcService.mockReset();
  mockExecuteGuarded.mockReset().mockResolvedValue(okResult);
  resetAcsGuardCache();
});
afterEach(() => {
  delete process.env['ACS_MODE'];
  resetAcsGuardCache();
});

describe('acsGuardToolExecution', () => {
  it('ACS_MODE=off is a pure passthrough (no SDK, no postgrest)', async () => {
    process.env['ACS_MODE'] = 'off';
    const run = vi.fn().mockResolvedValue(okResult);
    const out = await acsGuardToolExecution(CALL, null, run);
    expect(out).toBe(okResult);
    expect(run).toHaveBeenCalledTimes(1);
    expect(mockRpcService).not.toHaveBeenCalled();
    expect(mockExecuteGuarded).not.toHaveBeenCalled();
  });

  it('ACS_MODE=enforce fails CLOSED when readback persistence throws — effect is aborted, tool never runs', async () => {
    process.env['ACS_MODE'] = 'enforce';
    // acs_effect_propose FK-fails (placeholder intent anchor / DB unreachable).
    mockRpcService.mockRejectedValueOnce(new Error('FK violation: intent does not exist'));
    const run = vi.fn().mockResolvedValue(okResult);

    const out = await acsGuardToolExecution(CALL, null, run);

    expect(out.ok).toBe(false);
    expect(out.content).toContain('fail-closed');
    expect(run).not.toHaveBeenCalled();          // the underlying tool did NOT execute
    expect(mockExecuteGuarded).not.toHaveBeenCalled();
  });

  it('ACS_MODE=enforce runs the guarded effect when the readback trail persists', async () => {
    process.env['ACS_MODE'] = 'enforce';
    mockRpcService.mockResolvedValue(undefined); // propose + decide + mark_executed all succeed
    const run = vi.fn().mockResolvedValue(okResult);

    const out = await acsGuardToolExecution(CALL, 'int_0000000000000000000000000A', run);

    expect(mockExecuteGuarded).toHaveBeenCalledTimes(1);
    expect(out).toBe(okResult);
    // propose, decide, mark_executed
    expect(mockRpcService).toHaveBeenCalledWith('acs_effect_propose', expect.anything());
    expect(mockRpcService).toHaveBeenCalledWith('acs_effect_mark_executed', expect.anything());
  });
});
