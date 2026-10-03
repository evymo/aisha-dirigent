/**
 * Model self-test runner — locks that each pending model is probed and its verdict
 * recorded: a responding model → passed, a throwing/empty one → failed (rejected),
 * soft per-model.
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

import { selfTestModels, type SelfTestRpc, type SelfTestChat } from '../lib/modelSelfTest.js';

const oneDueModel = (id = 'm1', model = 'gpt-x'): SelfTestRpc => {
  return async (fn) => (fn === 'get_models_due_self_test' ? [{ id, provider: 'openai', model_id: model }] : null);
};

describe('selfTestModels', () => {
  it('a responding model passes → records p_passed=true', async () => {
    const recorded: Array<Record<string, unknown>> = [];
    const rpc: SelfTestRpc = async (fn, args) => {
      if (fn === 'record_model_self_test') recorded.push(args);
      return fn === 'get_models_due_self_test' ? [{ id: 'm1', provider: 'openai', model_id: 'gpt-x' }] : null;
    };
    const chat: SelfTestChat = async () => ({ text: 'OK' });

    const res = await selfTestModels(rpc, chat, { serviceableProviders: new Set(['openai']) });
    expect(res).toEqual({ tested: 1, passed: 1, failed: 0 });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ p_model_registry_id: 'm1', p_passed: true, p_task_type: 'smoke' });
    expect(recorded[0].p_overall).toBeGreaterThan(0);
  });

  it('a throwing (unreachable) model fails → rejected verdict, run never aborts', async () => {
    const recorded: Array<Record<string, unknown>> = [];
    const rpc: SelfTestRpc = async (fn, args) => {
      if (fn === 'record_model_self_test') recorded.push(args);
      return fn === 'get_models_due_self_test' ? [{ id: 'm1', provider: 'openai', model_id: 'gpt-x' }] : null;
    };
    const chat: SelfTestChat = async () => {
      throw new Error('unreachable');
    };

    const res = await selfTestModels(rpc, chat, { serviceableProviders: new Set(['openai']) });
    expect(res).toEqual({ tested: 1, passed: 0, failed: 1 });
    expect(recorded[0]).toMatchObject({ p_passed: false, p_overall: 0 });
  });

  it('an empty response counts as failed', async () => {
    const chat: SelfTestChat = async () => ({ text: '   ' });
    const res = await selfTestModels(oneDueModel(), chat, { serviceableProviders: new Set(['openai']) });
    expect(res.failed).toBe(1);
  });

  it('skips a model whose provider is NOT serviceable (no key) — stays pending, not wrongly rejected', async () => {
    const recorded: Array<Record<string, unknown>> = [];
    const rpc: SelfTestRpc = async (fn, args) => {
      if (fn === 'record_model_self_test') recorded.push(args);
      return fn === 'get_models_due_self_test' ? [{ id: 'm1', provider: 'anthropic', model_id: 'claude-x' }] : null;
    };
    const res = await selfTestModels(rpc, async () => ({ text: 'OK' }), { serviceableProviders: new Set(['openai']) });
    expect(res).toEqual({ tested: 0, passed: 0, failed: 0 });
    expect(recorded, 'a non-serviceable model must NOT be recorded (would wrongly reject it)').toHaveLength(0);
  });

  it('skips a NON-CHAT model (embedding/tts/…) from the chat smoke — never probes it as chat, so its 4xx cannot false-down the whole provider', async () => {
    const recorded: Array<Record<string, unknown>> = [];
    let chatCalls = 0;
    const rpc: SelfTestRpc = async (fn, args) => {
      if (fn === 'record_model_self_test') recorded.push(args);
      return fn === 'get_models_due_self_test' ? [{ id: 'm1', provider: 'openai', model_id: 'text-embedding-3-small' }] : null;
    };
    const chat: SelfTestChat = async () => {
      chatCalls += 1;
      return { text: 'OK' };
    };
    const res = await selfTestModels(rpc, chat, { serviceableProviders: new Set(['openai']) });
    expect(res).toEqual({ tested: 0, passed: 0, failed: 0 });
    expect(chatCalls, 'a non-chat model must NOT be chat-smoke-tested (its 4xx would false-down the provider)').toBe(0);
    expect(recorded, 'a non-chat model is capability-known, not a failure — must not be recorded as rejected').toHaveLength(0);
  });

  it('⛔ model objevený na vLLM pod aliasem BEZ prefixu se měří u vLLM, ne u providera uhodnutého z id', async () => {
    // Naměřeno 2026-09-13: resolveProvider('default-lens') vrátil 'openai' → 404 → rejected.
    const providers: string[] = [];
    const rpc: SelfTestRpc = async (fn) =>
      fn === 'get_models_due_self_test' ? [{ id: 'm1', provider: 'vllm', model_id: 'default-lens' }] : null;
    const chat: SelfTestChat = async (o) => {
      providers.push(o.provider);
      return { text: 'OK' };
    };
    const res = await selfTestModels(rpc, chat, { serviceableProviders: new Set(['vllm']) });
    expect(res.passed).toBe(1);
    expect(providers, 'provider musí přijít z řádku registru').toEqual(['vllm']);
  });

  it('nothing due → no-op', async () => {
    const rpc: SelfTestRpc = async () => [];
    const res = await selfTestModels(rpc, async () => ({ text: 'OK' }), { serviceableProviders: new Set(['openai']) });
    expect(res).toEqual({ tested: 0, passed: 0, failed: 0 });
  });

  it('re-test mode threads p_mode + FORCES the verdict (p_force=true)', async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const rpc: SelfTestRpc = async (fn, args) => {
      calls.push({ fn, args });
      return fn === 'get_models_due_self_test' ? [{ id: 'm1', provider: 'openai', model_id: 'gpt-x' }] : null;
    };
    await selfTestModels(rpc, async () => ({ text: 'OK' }), { serviceableProviders: new Set(['openai']), mode: 'rejected-only' });
    expect(calls.find((c) => c.fn === 'get_models_due_self_test')?.args.p_mode).toBe('rejected-only');
    expect(calls.find((c) => c.fn === 'record_model_self_test')?.args.p_force).toBe(true);
  });

  it('default (no mode) stays p_mode=pending + p_force=false', async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const rpc: SelfTestRpc = async (fn, args) => {
      calls.push({ fn, args });
      return fn === 'get_models_due_self_test' ? [{ id: 'm1', provider: 'openai', model_id: 'gpt-x' }] : null;
    };
    await selfTestModels(rpc, async () => ({ text: 'OK' }), { serviceableProviders: new Set(['openai']) });
    expect(calls.find((c) => c.fn === 'get_models_due_self_test')?.args.p_mode).toBe('pending');
    expect(calls.find((c) => c.fn === 'record_model_self_test')?.args.p_force).toBe(false);
  });
});
