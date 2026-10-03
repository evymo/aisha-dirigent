/**
 * Benchmark runner — records one current benchmark per (model, task_type), groups a soft
 * eval-run, skips non-serviceable providers, and scores a chat failure as a miss without
 * aborting. Injected rpc + chat keep it deterministic (no network, no real LLM).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@aisha/security', () => ({
  createSafeLogger: () => ({ safeInfo: vi.fn(), safeWarn: vi.fn(), safeError: vi.fn(), safeDebug: vi.fn() }),
  createSsrfGuard: () => ({ safeFetch: vi.fn() }),
  parseHostAllowlist: (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

import { benchmarkModels, type BenchmarkChat, type BenchmarkRpc } from '../lib/benchmarkRunner.js';
import { selectServiceableProviderForms } from '../lib/llmRouter.js';
import type { BenchmarkTask } from '../lib/benchmarkScorer.js';

const tasks: BenchmarkTask[] = [
  { id: 'a', task_type: 'chat', prompt: 'capital of France?', expect: { contains: 'Paris' } },
  { id: 'b', task_type: 'chat', prompt: 'echo OK', expect: { contains: 'OK' } },
];
const SERVICEABLE = new Set(['openai']);

describe('benchmarkModels', () => {
  it('records ONE benchmark per (model, task_type) + creates an eval-run', async () => {
    const recorded: Array<Record<string, unknown>> = [];
    const rpc: BenchmarkRpc = async (fn, args) => {
      if (fn === 'create_eval_run_admin') return 'run-1';
      if (fn === 'record_model_benchmark') recorded.push(args);
      return null;
    };
    const chat: BenchmarkChat = async (o) => ({
      text: o.messages[0].content.includes('France') ? 'Paris' : 'OK',
      usage: { inputTokens: 5, outputTokens: 2 },
    });

    const res = await benchmarkModels(rpc, [{ id: 'm1', provider: 'openai', model_id: 'gpt-x' }], {
      tasks,
      chat,
      serviceableProviders: SERVICEABLE,
    });

    expect(res.evalRunId).toBe('run-1');
    expect(res.modelsBenchmarked).toBe(1);
    expect(recorded).toHaveLength(1); // one (m1, 'chat') aggregated row — not one per task
    expect(recorded[0]).toMatchObject({
      p_model_registry_id: 'm1',
      p_task_type: 'chat',
      p_eval_run_id: 'run-1',
      p_sample_count: 2,
      p_overall: 1, // both tasks correct
      p_success_rate: 1,
    });
  });

  it('skips a non-serviceable provider (no key here)', async () => {
    const recorded: Array<Record<string, unknown>> = [];
    const rpc: BenchmarkRpc = async (fn, args) => {
      if (fn === 'record_model_benchmark') recorded.push(args);
      return fn === 'create_eval_run_admin' ? 'r' : null;
    };
    const res = await benchmarkModels(rpc, [{ id: 'm1', provider: 'anthropic', model_id: 'claude-x' }], {
      tasks,
      chat: async () => ({ text: 'x' }),
      serviceableProviders: SERVICEABLE,
    });
    expect(res.modelsBenchmarked).toBe(0);
    expect(recorded).toHaveLength(0);
  });

  it('does NOT skip a google-provider model when google is serviceable (gemini-skip regression)', async () => {
    // ai_model_registry.provider stores the backend-id form ('google'); the serviceable set must
    // contain that form. The slug-only 'google-genai' (selectServiceableSlugs) would skip every gemini.
    const recorded: Array<Record<string, unknown>> = [];
    const rpc: BenchmarkRpc = async (fn, args) => {
      if (fn === 'record_model_benchmark') recorded.push(args);
      return fn === 'create_eval_run_admin' ? 'r' : null;
    };
    const res = await benchmarkModels(rpc, [{ id: 'g1', provider: 'google', model_id: 'gemini-2.5-flash' }], {
      tasks,
      chat: async () => ({ text: 'Paris OK' }),
      serviceableProviders: new Set(['openai', 'google-genai', 'google', 'anthropic']),
    });
    expect(res.modelsBenchmarked, 'a google-provider model must be benchmarked, not silently skipped').toBe(1);
    expect(recorded[0]).toMatchObject({ p_model_registry_id: 'g1', p_task_type: 'chat' });
  });

  it('the slug-only serviceable set (the old bug) WOULD skip a google-provider model', async () => {
    const recorded: Array<Record<string, unknown>> = [];
    const rpc: BenchmarkRpc = async (fn, args) => {
      if (fn === 'record_model_benchmark') recorded.push(args);
      return fn === 'create_eval_run_admin' ? 'r' : null;
    };
    const res = await benchmarkModels(rpc, [{ id: 'g1', provider: 'google', model_id: 'gemini-2.5-flash' }], {
      tasks,
      chat: async () => ({ text: 'x' }),
      serviceableProviders: new Set(['google-genai']), // slug only — what selectServiceableSlugs() emits
    });
    expect(res.modelsBenchmarked, 'slug-only set skips google → confirms selectServiceableProviderForms is required').toBe(0);
  });

  it('⛔ model objevený na vLLM pod aliasem se benchmarkuje u vLLM (provider z řádku, ne z id)', async () => {
    const providers = new Set<string>();
    const rpc: BenchmarkRpc = async (fn) => (fn === 'create_eval_run_admin' ? 'r' : null);
    const res = await benchmarkModels(rpc, [{ id: 'v1', provider: 'vllm', model_id: 'default-lens' }], {
      tasks,
      chat: async (o) => {
        providers.add(o.provider);
        return { text: 'Paris OK' };
      },
      serviceableProviders: new Set(['vllm', 'vllm-local']),
    });
    expect(res.modelsBenchmarked).toBe(1);
    expect([...providers], 'resolveProvider("default-lens") by vrátil openai').toEqual(['vllm']);
  });

  it('a chat failure scores as a miss — run never aborts', async () => {
    const recorded: Array<Record<string, unknown>> = [];
    const rpc: BenchmarkRpc = async (fn, args) => {
      if (fn === 'record_model_benchmark') recorded.push(args);
      return fn === 'create_eval_run_admin' ? 'r' : null;
    };
    const res = await benchmarkModels(rpc, [{ id: 'm1', provider: 'openai', model_id: 'gpt-x' }], {
      tasks,
      chat: async () => {
        throw new Error('unreachable');
      },
      serviceableProviders: SERVICEABLE,
    });
    expect(res.modelsBenchmarked).toBe(1);
    expect(recorded[0]).toMatchObject({ p_overall: 0, p_success_rate: 0 });
  });

  it('soft eval-run: a create failure → evalRunId null but still benchmarks', async () => {
    const recorded: Array<Record<string, unknown>> = [];
    const rpc: BenchmarkRpc = async (fn, args) => {
      if (fn === 'create_eval_run_admin') throw new Error('no run');
      if (fn === 'record_model_benchmark') recorded.push(args);
      return null;
    };
    const res = await benchmarkModels(rpc, [{ id: 'm1', provider: 'openai', model_id: 'gpt-x' }], {
      tasks,
      chat: async () => ({ text: 'Paris OK' }),
      serviceableProviders: SERVICEABLE,
    });
    expect(res.evalRunId).toBeNull();
    expect(recorded[0].p_eval_run_id).toBeNull();
  });
});

describe('selectServiceableProviderForms', () => {
  it('returns BOTH the slug AND the backend-id form (so ai_model_registry.provider matches either)', () => {
    const forms = selectServiceableProviderForms([{ id: 'google' }, { id: 'openai' }]);
    expect(forms).toContain('google-genai'); // slug form (resolver / ai_provider_registry.slug)
    expect(forms).toContain('google'); // backend-id form (ai_model_registry.provider)
    expect(forms).toContain('openai'); // openai: id === slug
  });
});
