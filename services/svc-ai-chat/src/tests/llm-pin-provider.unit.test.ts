/**
 * Měření konkrétního (provider, model) — `unifiedChat({ pinProvider: true })`.
 *
 * ⛔ NAMĚŘENO 2026-09-13: self-test a benchmark odvozovaly providera z id modelu.
 * Alias lokálního modelu (`default-lens`) žádný prefix nemá → `openai` → 404 →
 * model odmítnut. A běžná cesta `unifiedChat` při selhání přes re-resolve
 * odpoví JINÝM modelem — pro měření to znamená verdikt připsaný špatnému modelu.
 *
 * Tyhle testy drží tři vlastnosti připnutého dispatche:
 *   1. jde výhradně na backend `provider`, i když jiný backend „umí" id podle prefixu,
 *   2. selhání se NEPŘESMĚRUJE a nepíše zdraví providera ani nevolá resolver,
 *   3. provider se čte z řádku registru v obou tvarech (id i slug); neznámý → null.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@aisha/security', () => ({
  createSafeLogger: () => ({ safeInfo: vi.fn(), safeWarn: vi.fn(), safeError: vi.fn(), safeDebug: vi.fn() }),
  createSsrfGuard: () => ({ safeFetch: vi.fn() }),
  parseHostAllowlist: (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean),
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

import { unifiedChat, setRouterRpc, providerForRegistryRow, type RouterRpc } from '../lib/llmRouter.js';
import { getRegistry, resetRegistry } from '@aisha/llm-dispatch';
import type { InferenceBackend, ChatRequest, ChatResponse, HealthResult } from '@aisha/llm-dispatch';

const PROVIDER_ENV_VARS = [
  'OPENAI_API_KEY', 'GOOGLE_AI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY', 'OLLAMA_URL',
  'DOCKER_MODEL_RUNNER_URL', 'VLLM_GENERATION_URL', 'MAESTRO_URL', 'MAESTRO_API_KEY',
  'AISHA_LLM_GATEWAY_URL', 'AISHA_LLM_GATEWAY_KEY',
] as const;

function stub(id: string, serves: (m: string) => boolean, chat: (r: ChatRequest) => Promise<ChatResponse>): InferenceBackend {
  return {
    id,
    label: `stub:${id}`,
    kind: 'local',
    supportsTools: false,
    defaultTimeoutMs: 1000,
    priority: 10,
    healthCheck: async (): Promise<HealthResult> => ({ available: true, latencyMs: 1 }),
    canServe: serves,
    normalizeModel: (m: string) => m,
    chat,
  };
}

const ok = (backendId: string, model: string): ChatResponse => ({
  text: `ok from ${backendId}`,
  usage: { inputTokens: 1, outputTokens: 1 },
  backendId,
  model,
});

describe('unifiedChat pinProvider — měření bez odhadu a bez fallbacku', () => {
  let rpcCalls: string[];

  beforeEach(() => {
    for (const key of PROVIDER_ENV_VARS) vi.stubEnv(key, '');
    resetRegistry();
    rpcCalls = [];
    const rpc: RouterRpc = async <T>(fn: string): Promise<T | null> => {
      rpcCalls.push(fn);
      return null as T;
    };
    setRouterRpc(rpc);
  });
  afterEach(() => {
    setRouterRpc();
    resetRegistry();
    vi.unstubAllEnvs();
  });

  it('jde výhradně na připnutý backend, i když jiný backend id „umí" podle prefixu', async () => {
    const openaiChat = vi.fn(async (r: ChatRequest) => ok('openai', r.model));
    const vllmChat = vi.fn(async (r: ChatRequest) => ok('vllm', r.model));
    getRegistry().addBackend(stub('openai', (m) => m.startsWith('gpt'), openaiChat));
    getRegistry().addBackend(stub('vllm', () => false, vllmChat));

    // Id s prefixem cizího providera — OSS model servírovaný lokálně.
    const res = await unifiedChat({
      provider: 'vllm',
      model: 'gpt-oss-local',
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      pinProvider: true,
    });

    expect(res.provider).toBe('vllm');
    expect(vllmChat).toHaveBeenCalledTimes(1);
    expect(openaiChat, 'prefixová resolveBackends cesta by poslala měření k OpenAI').not.toHaveBeenCalled();
  });

  it('⛔ selhání se nepřesměruje: žádný jiný backend, žádný zápis zdraví, žádný re-resolve', async () => {
    const anthropicChat = vi.fn(async (r: ChatRequest) => ok('anthropic', r.model));
    getRegistry().addBackend(stub('vllm', () => false, async () => {
      throw new Error('model default-lens not found');
    }));
    getRegistry().addBackend(stub('anthropic', (m) => m.startsWith('claude'), anthropicChat));

    await expect(
      unifiedChat({ provider: 'vllm', model: 'default-lens', messages: [{ role: 'user', content: 'x' }], pinProvider: true }),
    ).rejects.toThrow(/default-lens not found/);

    expect(anthropicChat).not.toHaveBeenCalled();
    expect(rpcCalls, 'měření jednoho modelu není důkaz o zdraví providera').toEqual([]);
  });

  it('⛔ nenakonfigurovaný připnutý provider = chyba, ne tichý přesun jinam', async () => {
    getRegistry().addBackend(stub('openai', () => true, async (r) => ok('openai', r.model)));
    await expect(
      unifiedChat({ provider: 'vllm', model: 'default-lens', messages: [{ role: 'user', content: 'x' }], pinProvider: true }),
    ).rejects.toThrow(/není v tomhle procesu nakonfigurovaný/);
  });

  it('kontrolní vzorek: BEZ pinProvider jde id s prefixem na prefixový backend (proto měření pin potřebuje)', async () => {
    const openaiChat = vi.fn(async (r: ChatRequest) => ok('openai', r.model));
    const vllmChat = vi.fn(async (r: ChatRequest) => ok('vllm', r.model));
    getRegistry().addBackend(stub('openai', (m) => m.startsWith('gpt'), openaiChat));
    getRegistry().addBackend(stub('vllm', () => false, vllmChat));

    await unifiedChat({ provider: 'vllm', model: 'gpt-oss-local', messages: [{ role: 'user', content: 'x' }] });
    expect(openaiChat).toHaveBeenCalledTimes(1);
    expect(vllmChat).not.toHaveBeenCalled();
  });
});

describe('providerForRegistryRow', () => {
  it('čte oba tvary registru (rodinný klíč i slug)', () => {
    expect(providerForRegistryRow('vllm')).toBe('vllm');
    expect(providerForRegistryRow('vllm-local')).toBe('vllm');
    expect(providerForRegistryRow('google')).toBe('google');
    expect(providerForRegistryRow('google-genai')).toBe('google');
    expect(providerForRegistryRow('llm-gateway')).toBe('gateway');
    expect(providerForRegistryRow('openai')).toBe('openai');
  });

  it('⛔ neznámý provider je null — nikdy odhad z id', () => {
    expect(providerForRegistryRow('mlx')).toBeNull();
    expect(providerForRegistryRow('')).toBeNull();
  });
});
