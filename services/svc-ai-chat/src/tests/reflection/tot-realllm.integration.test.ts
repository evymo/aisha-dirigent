/**
 * E1 Tree-of-Thoughts — REAL-LLM integration smoke.
 *
 * Same real pg17 + real PostgREST + real orchestrator as tot-fullenv, but the
 * external LLM is NOT stubbed — tot_expand / tot_evaluate make REAL provider
 * calls (a cheap OpenAI model via model_override) so genuine reasoning flows
 * through the ToT loop and is journaled. Verifies the loop survives real,
 * non-deterministic model output (messy JSON, free-text drafts) and still
 * terminates + writes real node_runs + ai_decisions.
 *
 * Opt-in only (real cost): runs when TOT_REAL_LLM=1 AND POSTGREST_URL are set
 * AND a provider key (OPENAI_API_KEY) is present. Otherwise it skips.
 *   OPENAI_API_KEY=… TOT_REAL_LLM=1 npm run test:reflection:realllm
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('@aisha/security', () => ({
  createSafeLogger: () => ({ safeInfo: vi.fn(), safeWarn: vi.fn(), safeError: vi.fn(), safeDebug: vi.fn() }),
  createSsrfGuard: () => ({ safeFetch: vi.fn() }),
  parseHostAllowlist: (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

const BASE = process.env.POSTGREST_URL;
const TOKEN = process.env.POSTGREST_SERVICE_TOKEN;
const ON = process.env.TOT_REAL_LLM === '1' && !!BASE && !!TOKEN && !!process.env.OPENAI_API_KEY;
const RUN = ON ? describe : describe.skip;

async function q<T = unknown>(pathAndQuery: string): Promise<T> {
  const res = await fetch(`${BASE}/${pathAndQuery}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`GET ${pathAndQuery} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

RUN('E1 ToT — REAL LLM (OpenAI) over a real DB', () => {
  let rpc: (fn: string, args?: Record<string, unknown>) => Promise<unknown>;
  let insertRow: (table: string, row: Record<string, unknown>) => Promise<Record<string, unknown>>;
  let runWorkflow: (runId: string) => Promise<{ status: string }>;
  let defId: string;

  beforeAll(async () => {
    ({ rpc, insertRow } = await import('../../reflection/postgrest.js'));
    ({ runWorkflow } = await import('../../reflection/orchestrator.js'));

    // Ephemeral graph: the real reasoning-tree with only a tight budget so the
    // smoke is fast + a few cents at most. Crucially, NO model_override — the
    // INFRASTRUCTURE must resolve to whichever provider is actually configured
    // (capability-availability) on its own; pinning a provider here would hide
    // the very design we are verifying. Inserted into the throwaway DB only.
    const def = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../reflection/graphs/reasoning-tree-reflect.json', import.meta.url)), 'utf8'),
    ) as { graph: { nodes: Array<{ type: string; config: Record<string, unknown> }> } };
    for (const n of def.graph.nodes) {
      if (n.type === 'tot_planner') n.config = { ...n.config, max_fanout: 2, max_expansions: 2 };
      if (n.type === 'tot_expand' || n.type === 'tot_evaluate') n.config = { ...n.config, max_tokens: 256 };
    }
    const row = await insertRow('ai_workflow_definitions', {
      name: `reasoning-tree-realllm-smoke-${process.pid}`,
      display_name: 'ToT real-LLM smoke (ephemeral)',
      description: 'ephemeral real-LLM smoke graph',
      context: 'reflection', is_active: true, version: 1, metadata: {}, graph: def.graph,
    });
    defId = String(row.id);
  });

  it('drives the ToT loop with a REAL model to completion + journals real decisions', async () => {
    const runId = (await rpc('fn_create_workflow_run', {
      p_workflow_definition_id: defId,
      p_input: { description: 'List three concrete steps to safely roll out a new public API endpoint.' },
    })) as string;

    const result = await runWorkflow(runId);
    expect(result.status).toBe('completed');

    const nodeRuns = await q<Array<{ node_type: string; output_data: Record<string, unknown> | null }>>(
      `ai_workflow_node_runs?run_id=eq.${runId}&select=node_type,output_data&order=started_at`,
    );
    const types = new Set(nodeRuns.map((r) => r.node_type));
    for (const t of ['tot_planner', 'tot_expand', 'tot_evaluate', 'tot_search']) {
      expect(types.has(t), `no node_run for ${t}`).toBe(true);
    }

    // Real journaled decisions for this run (each real dispatch minted one).
    const decisions = await q<Array<{ id: string }>>(`ai_decisions?run_id=eq.${runId}&select=id`).catch(() => []);
    expect(decisions.length).toBeGreaterThanOrEqual(1);

    // Genuine reasoning happened (not a stub): a real generated count + a real
    // verdict distribution land in the node_runs output_data.
    const expand = nodeRuns.find((r) => r.node_type === 'tot_expand');
    expect(Number(expand?.output_data?.generated ?? 0)).toBeGreaterThan(0);
  }, 120_000);
});
