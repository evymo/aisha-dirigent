/**
 * E1 Tree-of-Thoughts — REAL-environment integration test.
 *
 * Drives the REAL reflection orchestrator (runWorkflow) over the SEEDED
 * reasoning-tree graph against a REAL pg17 + a REAL PostgREST. Nothing in the DB
 * path is mocked — postgrest.ts, the checkpointer, contextLoader, every ToT node
 * handler and the ai_decisions journal all run for real. ONLY the external LLM
 * (lib/llmRouter.unifiedChat) is stubbed deterministically, because we never hit
 * a paid provider from a test.
 *
 * Provisioned by:
 *   node scripts/db/with-throwaway-db.mjs -- \
 *     node scripts/db/with-throwaway-postgrest.mjs -- \
 *       <vitest>            (exports POSTGREST_URL + POSTGREST_SERVICE_TOKEN)
 * Run: npm run test:reflection:fullenv   (skips offline — no POSTGREST_URL).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

// Stub ONLY the external LLM. The decision journal + postgrest stay real.
const { unifiedChat } = vi.hoisted(() => ({ unifiedChat: vi.fn() }));
vi.mock('@aisha/security', () => ({
  createSafeLogger: () => ({ safeInfo: vi.fn(), safeWarn: vi.fn(), safeError: vi.fn(), safeDebug: vi.fn() }),
  createSsrfGuard: () => ({ safeFetch: vi.fn() }),
  parseHostAllowlist: (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));
// Spread the REAL module so every export (resolveProvider, resolveAvailableModel,
// selectServiceableSlugs …) stays present as decision.ts evolves; stub ONLY the
// network call. A hand-listed mock silently breaks when a new llmRouter import is
// added to the loaded graph (it did, when decision.ts began importing the resolver).
vi.mock('../../lib/llmRouter.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/llmRouter.js')>();
  return { ...actual, unifiedChat };
});

const BASE = process.env.POSTGREST_URL;
const TOKEN = process.env.POSTGREST_SERVICE_TOKEN;
const RUN = BASE && TOKEN ? describe : describe.skip;

async function q<T = unknown>(pathAndQuery: string): Promise<T> {
  const res = await fetch(`${BASE}/${pathAndQuery}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`GET ${pathAndQuery} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

RUN('E1 ToT — real DB + PostgREST + real orchestrator', () => {
  let rpc: (fn: string, args?: Record<string, unknown>) => Promise<unknown>;
  let runWorkflow: (runId: string) => Promise<{ status: string }>;
  let defId: string;

  beforeAll(async () => {
    ({ rpc } = await import('../../reflection/postgrest.js'));
    ({ runWorkflow } = await import('../../reflection/orchestrator.js'));
    // expand → a draft; evaluate (jsonMode) → high scores so a 'sure' thought
    // terminates the search quickly + deterministically.
    unifiedChat.mockImplementation(async (opts: { jsonMode?: boolean }) =>
      opts.jsonMode
        ? {
            text: JSON.stringify({ scores: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`t${i + 1}`, 0.95])) }),
            model: 'stub', provider: 'stub', usage: { inputTokens: 1, outputTokens: 1 },
          }
        : { text: 'a concrete next thought', model: 'stub', provider: 'stub', usage: { inputTokens: 1, outputTokens: 1 } },
    );
  });

  it('the reasoning-tree graph is seeded + loadable from real ai_workflow_definitions', async () => {
    const rows = await q<Array<{ id: string; is_active: boolean; graph: { entry: string; nodes: unknown[] } }>>(
      'ai_workflow_definitions?name=eq.reasoning-tree-reflect&select=id,is_active,graph',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].is_active).toBe(true);
    expect(rows[0].graph.entry).toBe('tot_planner');
    expect(Array.isArray(rows[0].graph.nodes)).toBe(true);
    expect(rows[0].graph.nodes).toHaveLength(4);
    defId = rows[0].id;
  });

  it('runWorkflow executes the ToT loop end-to-end: real node_runs + journaled decisions + completed', async () => {
    // Bind the run DIRECTLY to the reasoning-tree definition — aisha_choose_execution_strategy
    // does not route to it (E1 routing is a later wire-up), so we invoke by id.
    const runId = (await rpc('fn_create_workflow_run', {
      p_workflow_definition_id: defId,
      p_input: { description: 'Plan a 3-step rollout for feature X' },
    })) as string;
    expect(typeof runId).toBe('string');

    const decBefore = (await q<Array<unknown>>('ai_decisions?select=id')).length;

    const result = await runWorkflow(runId);
    expect(result.status).toBe('completed');

    // Real ai_workflow_node_runs for every ToT node type.
    const nodeRuns = await q<Array<{ node_type: string; status: string }>>(
      `ai_workflow_node_runs?run_id=eq.${runId}&select=node_type,status`,
    );
    const types = new Set(nodeRuns.map((r) => r.node_type));
    for (const t of ['tot_planner', 'tot_expand', 'tot_evaluate', 'tot_search']) {
      expect(types.has(t), `no ai_workflow_node_runs row for ${t}`).toBe(true);
    }

    // I1 against the REAL journal: the run's LLM dispatches each minted a decision.
    const decAfter = (await q<Array<unknown>>('ai_decisions?select=id')).length;
    expect(decAfter).toBeGreaterThan(decBefore);
  });
});
