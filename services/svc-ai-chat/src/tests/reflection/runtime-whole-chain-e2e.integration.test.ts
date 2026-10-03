/**
 * WHOLE-CHAIN e2e — proves every piece works TOGETHER, wired as one flow, for a
 * realistic task: aisha_choose_execution_strategy ROUTES it → the orchestrator runs
 * the runtime-execute graph → resolve_clow DERIVES the runtime+model + admits →
 * runtime_dispatch EXECUTES via the right adapter → the dispatch is TRACED → the run
 * COMPLETES. Not units in isolation — the integrated system.
 *
 *   - write/agentic task → openclaw, executed against a real local HTTP stub.
 *   - evaluate+story task → hermes, executed against the real evaluate_story_self rail.
 *
 * Run: npm run test:reflection:fullenv (skips offline).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// Override ONLY the openclaw fields; everything else (postgrest URL/token from env,
// node timeouts, …) falls through to the REAL config so the orchestrator behaves
// normally — a partial mock dropped the timeouts and broke runWorkflow.
const { override, unifiedChat } = vi.hoisted(() => ({
  override: { enableOpenclaw: true, openclawUrl: '', openclawApiKey: 'test-key' } as Record<string, unknown>,
  unifiedChat: vi.fn(),
}));
vi.mock('../../reflection/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../reflection/config.js')>();
  return {
    ...actual,
    reflectionConfig: new Proxy(actual.reflectionConfig as Record<string, unknown>, {
      get: (t, p: string) => (p in override ? override[p] : t[p]),
    }),
  };
});
vi.mock('@aisha/security', () => ({
  createSafeLogger: () => ({ safeInfo: vi.fn(), safeWarn: vi.fn(), safeError: vi.fn(), safeDebug: vi.fn() }),
  createSsrfGuard: () => ({ safeFetch: vi.fn() }),
  parseHostAllowlist: (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));
vi.mock('../../lib/llmRouter.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/llmRouter.js')>();
  return { ...actual, unifiedChat };
});

const BASE = process.env.POSTGREST_URL;
const TOKEN = process.env.POSTGREST_SERVICE_TOKEN;
const RUN = BASE && TOKEN ? describe : describe.skip;

async function q<T = unknown>(p: string): Promise<T> {
  const res = await fetch(`${BASE}/${p}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`GET ${p} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}
async function callRpc<T = unknown>(fn: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}/rpc/${fn}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST rpc/${fn} → ${res.status}: ${await res.text()}`);
  const t = await res.text();
  return (t ? JSON.parse(t) : null) as T;
}

type NodeRun = { node_type: string; output_data: { runtime?: string } | null; status: string };

RUN('WHOLE-CHAIN — task → chooser → orchestrator → resolve → dispatch → execute → trace', () => {
  let runWorkflow: (runId: string) => Promise<{ status: string }>;
  let server: Server;
  let stubHits = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      stubHits++;
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ output: 'openclaw executed the plan' }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    override.openclawUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    ({ runWorkflow } = await import('../../reflection/orchestrator.js'));
    unifiedChat.mockResolvedValue({ text: 'ok', model: 'stub', provider: 'openai', usage: { inputTokens: 1, outputTokens: 1 } });
  });

  afterAll(() => server?.close());

  it('WRITE task: chooser routes to runtime-execute → orchestrator → openclaw is derived, dispatched to the real stub, traced, completed', async () => {
    const before = stubHits;
    // 1) the chooser ROUTES the realistic task to the runtime-execute graph.
    const strategy = await callRpc<{ graph_slug: string; graph_id: string }>('aisha_choose_execution_strategy', {
      p_task: { description: 'implement and deploy the new auth feature' },
    });
    expect(strategy.graph_slug).toBe('runtime-execute');
    expect(strategy.graph_id).toBeTruthy();

    // 2) the production kick-off: a run bound to that graph, driven by the orchestrator.
    const rid = await callRpc<string>('fn_create_workflow_run', {
      p_workflow_definition_id: strategy.graph_id,
      p_input: { description: 'implement and deploy the new auth feature' },
    });
    const result = await runWorkflow(rid);
    expect(result.status).toBe('completed');

    // 3) the runtime DERIVED was openclaw, and it really dispatched to the stub.
    const nodeRuns = await q<NodeRun[]>(`ai_workflow_node_runs?run_id=eq.${rid}&select=node_type,output_data,status`);
    const dispatch = nodeRuns.find((n) => n.node_type === 'runtime_dispatch');
    expect(dispatch?.output_data?.runtime, 'runtime_dispatch did not run / not openclaw').toBe('openclaw');
    expect(stubHits, 'OpenClaw stub never received the dispatch').toBeGreaterThan(before);

    // 4) the dispatch was TRACED (observability wired into the same flow).
    const traces = await q<Array<{ operation: string | null }>>(`ai_trace_events?run_id=eq.${rid}&select=operation`);
    expect(traces.some((t) => (t.operation ?? '').includes('openclaw'))).toBe(true);
  });

  it('EVALUATE+STORY task: chooser routes to runtime-execute → orchestrator → hermes is derived + runs the real rail, completed', async () => {
    // hermes is the always-serviceable DB learning rail; enable it for selection.
    await callRpc('update_runtime_admin_audited', { p_is_enabled: true, p_slug: 'hermes' });

    const strategy = await callRpc<{ graph_slug: string; graph_id: string }>('aisha_choose_execution_strategy', {
      p_task: { description: 'evaluate the closed story', type: 'evaluate', story_id: '00000000-0000-0000-0000-000000000001' },
    });
    expect(strategy.graph_slug).toBe('runtime-execute');

    const rid = await callRpc<string>('fn_create_workflow_run', {
      p_workflow_definition_id: strategy.graph_id,
      p_input: { description: 'evaluate the closed story', type: 'evaluate' },
      p_story_id: '00000000-0000-0000-0000-000000000001',
    });
    const result = await runWorkflow(rid);
    expect(result.status).toBe('completed');

    const nodeRuns = await q<NodeRun[]>(`ai_workflow_node_runs?run_id=eq.${rid}&select=node_type,output_data,status`);
    const dispatch = nodeRuns.find((n) => n.node_type === 'runtime_dispatch');
    expect(dispatch?.output_data?.runtime, 'evaluate+story did not derive+dispatch hermes').toBe('hermes');
  });
});
