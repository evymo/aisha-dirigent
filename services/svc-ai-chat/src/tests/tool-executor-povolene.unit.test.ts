/**
 * Executor spustí jen povolený a nezakázaný nástroj (SELF_IMPROVEMENT_LOOP.md §3b, K-36).
 *
 * ⛔ NAMĚŘENO 2026-10-01 na main 8640db9ac: executeCore načetl JAKÝKOLI aktivní nástroj
 * podle jména (get_agent_tool), takže model nebo vložená instrukce mohl zavolat nástroj,
 * který mu kanál nenabídl; `agent_catalog.denied_tools` se za běhu nevynucoval vůbec
 * (route_task slučoval jen allowed_tools, executor zákazy neznal).
 *
 * Co se tu měří:
 *   1. nástroj z povolené sady se spustí                          ← kontrolní vzorek
 *   2. nástroj, o který si kanál neřekl → odmítnut, DB se vůbec nečte
 *   3. zakázaný nástroj se nenačte ani nespustí, i když ho kanál povoluje
 *   4. bez načtení sady se nespustí nic (fail-closed)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/acs/guard.js', () => ({
  acsGlobalMode: () => 'off',
  acsGuardToolExecution: async (_c: unknown, _x: unknown, fn: () => unknown) => fn(),
}));

import { createToolExecutor } from '../lib/toolExecutor.js';
import type { PostgrestClient } from '../lib/deps.js';
import type { Tracer } from '../lib/tracer.js';

function nastroj(name: string) {
  return {
    id: `id-${name}`,
    name,
    description: `nástroj ${name}`,
    parameters_schema: { type: 'object', properties: {} },
    handler_type: 'rpc',
    handler_ref: `fn_${name}`,
    access_tier_min: 'basic',
    requires_consent: false,
    audit_action: null,
    metadata: {},
  };
}

const sluzba = { rpc: vi.fn() };
const uzivatel = { rpc: vi.fn() };
const tracer = {
  event: vi.fn(async () => undefined),
  span: vi.fn(async (_t: string, _n: string, _h: string, _r: string, fn: () => Promise<unknown>) => fn()),
};

function executor(deniedTools: string[] = []) {
  return createToolExecutor(
    sluzba as unknown as PostgrestClient,
    uzivatel as unknown as PostgrestClient,
    'uzivatel-1',
    tracer as unknown as Tracer,
    { accessLevel: 'basic', deniedTools },
  );
}

const volani = (name: string) => ({ id: `call-${name}`, name, arguments: {} });

beforeEach(() => {
  sluzba.rpc.mockReset();
  uzivatel.rpc.mockReset();
  tracer.event.mockClear();
  sluzba.rpc.mockImplementation(async (fn: string, args: { p_name: string }) =>
    fn === 'get_agent_tool' ? { data: nastroj(args.p_name), error: null } : { data: null, error: null });
  uzivatel.rpc.mockResolvedValue({ data: { ok: true }, error: null });
});

describe('executor: jen povolené, zakázané nikdy (K-36)', () => {
  it('nástroj z povolené sady se spustí (kontrolní vzorek)', async () => {
    const ex = executor();
    await ex.loadToolsByNames(['hledej']);
    const r = await ex.execute(volani('hledej'));
    expect(r.ok, r.content).toBe(true);
    expect(uzivatel.rpc).toHaveBeenCalledWith('fn_hledej', {});
  });

  it('nástroj, o který si kanál neřekl → odmítnut, DB se nečte', async () => {
    const ex = executor();
    await ex.loadToolsByNames(['hledej']);
    sluzba.rpc.mockClear();
    const r = await ex.execute(volani('get_my_lab_results'));
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/not permitted/);
    expect(sluzba.rpc).not.toHaveBeenCalled();
    expect(uzivatel.rpc).not.toHaveBeenCalled();
  });

  it('zakázaný nástroj se nenačte ani nespustí, i když ho kanál povoluje', async () => {
    const ex = executor(['smaz']);
    const nactene = await ex.loadToolsByNames(['hledej', 'smaz']);
    expect(nactene.map((t) => t.name)).toEqual(['hledej']);
    const r = await ex.execute(volani('smaz'));
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/denied/);
    expect(uzivatel.rpc).not.toHaveBeenCalled();
  });

  it('bez načtení sady se nespustí nic (fail-closed)', async () => {
    const r = await executor().execute(volani('hledej'));
    expect(r.ok).toBe(false);
    expect(uzivatel.rpc).not.toHaveBeenCalled();
  });
});
