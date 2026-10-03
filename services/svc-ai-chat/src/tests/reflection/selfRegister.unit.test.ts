/**
 * selfRegisterRuntimes — reconciles in-process RuntimeAdapter liveness into
 * ai_runtime_registry on boot. These lock two regressions the CLI-runtime
 * unification introduced + fixed:
 *  - cli must be SKIPPED (its registry slug is 'cli:<tool>', never bare 'cli', and
 *    it is an out-of-process enqueue runtime svc-ai-chat does not execute), or
 *    update_runtime_admin_audited RAISES 'Runtime not found' on 'cli'.
 *  - one failing slug must NOT abort the whole reconcile (try/catch per iteration).
 */
import { describe, it, expect, vi } from 'vitest';

const { health } = vi.hoisted(() => ({ health: vi.fn() }));
vi.mock('../../reflection/runtime/adapters.js', () => ({ runtimeAdapterHealth: health }));

import { selfRegisterRuntimes } from '../../reflection/runtime/selfRegister.js';

describe('selfRegisterRuntimes', () => {
  it('SKIPS cli (slug mismatch / out-of-process) and reconciles the rest', async () => {
    health.mockReturnValue([
      { runtime: 'direct_llm', available: true },
      { runtime: 'cli', available: true },
      { runtime: 'openclaw', available: false },
    ]);
    const rpc = vi.fn().mockResolvedValue(undefined);
    const { enabled, disabled } = await selfRegisterRuntimes(rpc);

    // cli is never reconciled — no update_runtime_admin_audited with the bare 'cli' slug.
    expect(rpc).not.toHaveBeenCalledWith('update_runtime_admin_audited', expect.objectContaining({ p_slug: 'cli' }));
    expect(enabled).toContain('direct_llm');
    expect(disabled).toContain('openclaw');
    expect(enabled).not.toContain('cli');
    expect(disabled).not.toContain('cli');
  });

  it('one failing slug does NOT abort the reconcile (try/catch per iteration)', async () => {
    health.mockReturnValue([
      { runtime: 'direct_llm', available: true },
      { runtime: 'openclaw', available: true },
    ]);
    const rpc = vi.fn().mockImplementation((_fn: string, params: Record<string, unknown>) =>
      params.p_slug === 'direct_llm'
        ? Promise.reject(new Error('Runtime not found'))
        : Promise.resolve(undefined),
    );
    // Must not throw even though the first slug rejects.
    const { enabled } = await selfRegisterRuntimes(rpc);
    expect(rpc).toHaveBeenCalledTimes(2);            // BOTH attempted (no early abort)
    expect(enabled).toContain('openclaw');            // the survivor reconciled
    expect(enabled).not.toContain('direct_llm');      // the failure dropped, not counted
  });
});
