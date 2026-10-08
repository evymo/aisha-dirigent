/**
 * Executor /chat spouští nástroje dvou původů — agent_tools a MCP (SELF_IMPROVEMENT_LOOP.md §3b, K-35).
 *
 * ⛔ NAMĚŘENO 2026-10-01 na main 8640db9ac: výchozí allowed_tools kanálu jsou jména MCP
 * (search_knowledge, search_knowledge_v2, get_knowledge_item); executor znal jen agent_tools,
 * takže chat neměl žádný nástroj. Teď je MCP druhý původ — a K-36 (povolená sada kanálu
 * minus zákazy) pro něj platí stejně.
 *
 * Co se tu měří:
 *   1. nástroj MCP z povolené sady se nabídne se schématem MCP a spustí přes MCP ← kontrolní vzorek
 *   2. bez původu MCP (žádný token uživatele) se nástroj MCP nenabídne ani nespustí
 *   3. nástroj MCP, o který si kanál neřekl → odmítnut, MCP se nevolá (K-36)
 *   4. zakázaný nástroj MCP se nenačte ani nespustí, i když ho kanál povoluje (K-36)
 *   5. jméno v agent_tools i v MCP → dvojznačné, nespustí se ani jedním původem
 *   6. jméno bez původu (fantom) → nenabídne se, volání odmítnuto
 *   7. selhané volání MCP se hlásí jako selhání, ne jako výsledek
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/acs/guard.js', () => ({
  acsGlobalMode: () => 'off',
  acsGuardToolExecution: async (_c: unknown, _x: unknown, fn: () => unknown) => fn(),
}));

import { createToolExecutor, type McpToolOrigin } from '../lib/toolExecutor.js';
import type { PostgrestClient } from '../lib/deps.js';
import type { Tracer } from '../lib/tracer.js';

const REGISTROVANE = new Set(['get_my_lab_results', 'search_knowledge']);
const SCHEMA_MCP = { type: 'object', properties: { query: { type: 'string' } } };

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
const mcp = {
  list: vi.fn(async () => [
    { name: 'search_knowledge_v2', description: 'Hybrid KB search', parameters: SCHEMA_MCP },
    { name: 'get_knowledge_item', description: 'Load one item', parameters: SCHEMA_MCP },
    { name: 'search_knowledge', description: 'kolidující jméno', parameters: SCHEMA_MCP },
  ]),
  call: vi.fn(async () => ({ ok: true, text: '[{"chunk":"Praha"}]' })),
};

function executor(puvodMcp: McpToolOrigin | null, deniedTools: string[] = []) {
  return createToolExecutor(
    sluzba as unknown as PostgrestClient,
    uzivatel as unknown as PostgrestClient,
    'uzivatel-1',
    tracer as unknown as Tracer,
    { accessLevel: 'basic', deniedTools, mcp: puvodMcp },
  );
}

const volani = (name: string, args: Record<string, unknown> = {}) => ({ id: `call-${name}`, name, arguments: args });

beforeEach(() => {
  sluzba.rpc.mockReset();
  uzivatel.rpc.mockReset();
  mcp.call.mockClear();
  mcp.list.mockClear();
  tracer.event.mockClear();
  sluzba.rpc.mockImplementation(async (fn: string, args: { p_name: string }) =>
    fn === 'get_agent_tool' && REGISTROVANE.has(args.p_name)
      ? { data: nastroj(args.p_name), error: null }
      : { data: null, error: { message: 'not found' } });
  uzivatel.rpc.mockResolvedValue({ data: { ok: true }, error: null });
});

describe('executor: nástroje MCP jako druhý původ (K-35)', () => {
  it('nástroj MCP z povolené sady se nabídne se schématem MCP a spustí přes MCP (kontrolní vzorek)', async () => {
    const ex = executor(mcp);
    const nactene = await ex.loadToolsByNames(['search_knowledge_v2', 'get_my_lab_results']);
    const specs = ex.toOpenAIToolSpecs(nactene);
    expect(specs.map((s) => s.function.name).sort()).toEqual(['get_my_lab_results', 'search_knowledge_v2']);
    expect(specs.find((s) => s.function.name === 'search_knowledge_v2')?.function.parameters).toEqual(SCHEMA_MCP);

    const r = await ex.execute(volani('search_knowledge_v2', { query: 'hlavní město' }));
    expect(r.ok, r.content).toBe(true);
    expect(r.content).toBe('[{"chunk":"Praha"}]');
    expect(mcp.call).toHaveBeenCalledWith('search_knowledge_v2', { query: 'hlavní město' });
    expect(uzivatel.rpc).not.toHaveBeenCalled();

    // registrovaný nástroj dál jde svou cestou (RPC pod uživatelem), ne přes MCP
    const r2 = await ex.execute(volani('get_my_lab_results'));
    expect(r2.ok, r2.content).toBe(true);
    expect(uzivatel.rpc).toHaveBeenCalledWith('fn_get_my_lab_results', {});
    expect(mcp.call).toHaveBeenCalledTimes(1);
  });

  it('bez původu MCP (žádný token uživatele) se nástroj MCP nenabídne ani nespustí', async () => {
    const ex = executor(null);
    const nactene = await ex.loadToolsByNames(['search_knowledge_v2']);
    expect(nactene).toEqual([]);
    const r = await ex.execute(volani('search_knowledge_v2'));
    expect(r.ok).toBe(false);
    expect(mcp.list).not.toHaveBeenCalled();
    expect(mcp.call).not.toHaveBeenCalled();
  });

  it('nástroj MCP, o který si kanál neřekl → odmítnut, MCP se nevolá (K-36)', async () => {
    const ex = executor(mcp);
    await ex.loadToolsByNames(['search_knowledge_v2']);
    const r = await ex.execute(volani('get_knowledge_item'));
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/not permitted/);
    expect(mcp.call).not.toHaveBeenCalled();
  });

  it('zakázaný nástroj MCP se nenačte ani nespustí, i když ho kanál povoluje (K-36)', async () => {
    const ex = executor(mcp, ['get_knowledge_item']);
    const nactene = await ex.loadToolsByNames(['search_knowledge_v2', 'get_knowledge_item']);
    expect(nactene.map((t) => t.name)).toEqual(['search_knowledge_v2']);
    const r = await ex.execute(volani('get_knowledge_item'));
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/denied/);
    expect(mcp.call).not.toHaveBeenCalled();
  });

  it('jméno v agent_tools i v MCP je dvojznačné → nespustí se ani jedním původem', async () => {
    const ex = executor(mcp);
    const nactene = await ex.loadToolsByNames(['search_knowledge']);
    expect(nactene).toEqual([]);
    const r = await ex.execute(volani('search_knowledge'));
    expect(r.ok).toBe(false);
    expect(mcp.call).not.toHaveBeenCalled();
    expect(uzivatel.rpc).not.toHaveBeenCalled();
    expect(tracer.event).toHaveBeenCalledWith(
      'tool_call', 'search_knowledge', 'internal', 'origin_check', 'error', 0, expect.anything(),
    );
  });

  it('jméno bez původu (fantom) se nenabídne a jeho volání se odmítne dřív, než se cokoli hledá', async () => {
    const ex = executor(mcp);
    const nactene = await ex.loadToolsByNames(['search_ragnarok']);
    expect(nactene).toEqual([]);
    sluzba.rpc.mockClear();
    const r = await ex.execute(volani('search_ragnarok'));
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/not permitted/);
    expect(sluzba.rpc).not.toHaveBeenCalled();
    expect(mcp.call).not.toHaveBeenCalled();
  });

  it('selhané volání MCP se hlásí jako selhání, ne jako výsledek', async () => {
    mcp.call.mockResolvedValueOnce({ ok: false, text: '{"error":"tool_unavailable"}' });
    const ex = executor(mcp);
    await ex.loadToolsByNames(['search_knowledge_v2']);
    const r = await ex.execute(volani('search_knowledge_v2', { query: 'x' }));
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/tool_unavailable/);
  });
});
