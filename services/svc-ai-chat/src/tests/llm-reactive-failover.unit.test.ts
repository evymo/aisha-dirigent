/**
 * Reactive failover orchestration (master-plan A3) — the capability-availability loop in
 * lib/llmRouter.ts, exercised end-to-end through the public `unifiedChat()` entry.
 *
 * The two HALVES of A3 were already locked:
 *   - the pure remap (`resolveAvailableModel`) by llm-resolution-contract.unit.test.ts, and
 *   - the DB feedback (`record_provider_health_result` → resolver candidate filter) by
 *     src/tests/gates/provider-health-probe-flow.gate.test.ts.
 * The GLUE between them had ZERO assertions — the injected RPC seam `setRouterRpc` was
 * called by no test, so the runtime decision
 *
 *     dispatch failure
 *       → reportProviderFailure  (record_provider_health_result <slug> 'down')
 *       → reResolveExcluding     (aisha_resolve_clow_backend, serviceable_slugs MINUS failed)
 *       → re-dispatch to a DIFFERENT suitable provider, else DEFER (never a hardcoded fallback)
 *
 * was unverified. This file closes the master-plan §167 requirement: "assert that re-resolve
 * selects a DIFFERENT suitable provider after a dispatch failure" — plus the fail-loud twin
 * ([[feedback_no_fallbacks_fail_loud]]): when nothing else is suitable, it throws (defers) and
 * never fabricates a model id.
 *
 * Deterministic + network-free: the provider factories are mocked to null (empty base
 * registry, env-independent), two stub `InferenceBackend`s are registered via `addBackend`
 * (A always throws on chat(), B succeeds), and a stub `RouterRpc` captures the health write
 * and returns B from the resolver. The failover decision is the unit under test — no HTTP,
 * no keys, no real resolver.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Boundary mocks — keep llmRouter's logger/SSRF init inert (parity with the sibling unit tests).
vi.mock('@aisha/security', () => ({
  createSafeLogger: () => ({ safeInfo: vi.fn(), safeWarn: vi.fn(), safeError: vi.fn(), safeDebug: vi.fn() }),
  createSsrfGuard: () => ({ safeFetch: vi.fn() }),
  parseHostAllowlist: (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

// Empty base registry, deterministically, on ANY machine. Every provider factory self-guards on
// its env var and returns null when unset (createOpenAIBackend→OPENAI_API_KEY,
// createOllamaBackend→OLLAMA_URL, createGatewayBackend→AISHA_LLM_GATEWAY_URL/KEY, …). Scrubbing
// these in beforeEach makes getRegistry().initialize() register NOTHING from env, so the only
// backends present are the stubs this test adds via addBackend(). This anchors determinism to the
// factories' PUBLIC env contract instead of mocking their (now package-internal, post-extraction)
// module paths — network-free and refactor-proof. See [[project_router_consolidation_omni]].
const PROVIDER_ENV_VARS = [
  'OPENAI_API_KEY',
  'GOOGLE_AI_API_KEY',
  'ANTHROPIC_API_KEY',
  'XAI_API_KEY',
  'OLLAMA_URL',
  'DOCKER_MODEL_RUNNER_URL',
  'VLLM_GENERATION_URL',
  'MAESTRO_URL',
  'MAESTRO_API_KEY',
  'AISHA_LLM_GATEWAY_URL',
  'AISHA_LLM_GATEWAY_KEY',
] as const;

import { unifiedChat, setRouterRpc, selectServiceableSlugs, type RouterRpc } from '../lib/llmRouter.js';
import { getRegistry, resetRegistry } from '@aisha/llm-dispatch';
import type { InferenceBackend, ChatRequest, ChatResponse, HealthResult } from '@aisha/llm-dispatch';

/** A deterministic stub backend: serves exactly the models it's told, chat() is supplied. */
function stubBackend(opts: {
  id: string;
  serves: (model: string) => boolean;
  chat: (req: ChatRequest) => Promise<ChatResponse>;
}): InferenceBackend {
  return {
    id: opts.id,
    label: `stub:${opts.id}`,
    // 'local' kind always passes resolveBackends()' execution-mode filter (cloud is skipped
    // only when AISHA_EXECUTION_MODE='local'), so the test is mode-independent.
    kind: 'local',
    supportsTools: false,
    defaultTimeoutMs: 1000,
    priority: 10,
    healthCheck: async (): Promise<HealthResult> => ({ available: true, latencyMs: 1 }),
    canServe: (model: string) => opts.serves(model),
    normalizeModel: (model: string) => model,
    chat: opts.chat,
  };
}

const okResponse = (backendId: string, model: string): ChatResponse => ({
  text: `ok from ${backendId}`,
  usage: { inputTokens: 1, outputTokens: 1 },
  backendId,
  model,
});

describe('reactive failover (master-plan A3) — dispatch-fail → re-resolve a DIFFERENT provider', () => {
  let rpcCalls: Array<{ fn: string; params: Record<string, unknown> }>;

  beforeEach(() => {
    // Falsy every provider env var → each factory returns null → empty base registry (see above).
    for (const key of PROVIDER_ENV_VARS) vi.stubEnv(key, '');
    resetRegistry();
    rpcCalls = [];
  });
  afterEach(() => {
    setRouterRpc(); // reset to the default service-role RPC
    resetRegistry();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /** Install a RouterRpc stub: capture every call; aisha_resolve_clow_backend returns `top` (or defers). */
  function installRpc(top: { provider_slug: string; model_id: string; backend_kind?: string } | null): void {
    const rpc: RouterRpc = async <T>(fn: string, params: Record<string, unknown>): Promise<T | null> => {
      rpcCalls.push({ fn, params });
      if (fn === 'aisha_resolve_clow_backend') {
        return (top ? { resolved: true, top } : { resolved: false, top: null }) as T;
      }
      return null as T; // record_provider_health_result → void
    };
    setRouterRpc(rpc);
  }

  it('records the failure and re-dispatches to the resolver-chosen DIFFERENT provider (§167)', async () => {
    const aChat = vi.fn(async (): Promise<ChatResponse> => {
      throw new Error('provider A down');
    });
    const bChat = vi.fn(async (_req: ChatRequest) => okResponse('anthropic', 'claude-x-discovered'));
    getRegistry().addBackend(stubBackend({ id: 'openai', serves: (m) => m.startsWith('gpt'), chat: aChat }));
    getRegistry().addBackend(stubBackend({ id: 'anthropic', serves: (m) => m.startsWith('claude'), chat: bChat }));

    // The autonomous resolver picks provider B (anthropic) with a DISCOVERED model id.
    installRpc({ provider_slug: 'anthropic', model_id: 'claude-x-discovered' });

    const result = await unifiedChat({
      provider: 'openai',
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    });

    // 1. Failed over to a DIFFERENT provider, with the RE-RESOLVED model (not the original gpt-4o).
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-x-discovered');
    expect(result.text).toBe('ok from anthropic');
    expect(aChat).toHaveBeenCalledTimes(1); // A tried + failed
    expect(bChat).toHaveBeenCalledTimes(1); // B served the alternative
    expect(bChat.mock.calls[0][0].model).toBe('claude-x-discovered'); // alt got the re-resolved model

    // 2. Reactive feedback: the FAILED provider's slug was recorded 'down' (derived, not hardcoded).
    const health = rpcCalls.find((c) => c.fn === 'record_provider_health_result');
    expect(health).toBeDefined();
    expect(health!.params.p_slug).toBe(selectServiceableSlugs([{ id: 'openai' }])[0]); // 'openai'
    expect(health!.params.p_status).toBe('down');

    // 3. The resolver was asked with serviceable_slugs EXCLUDING the failed provider.
    const resolve = rpcCalls.find((c) => c.fn === 'aisha_resolve_clow_backend');
    expect(resolve).toBeDefined();
    const ctx = resolve!.params.p_context as { serviceable_slugs: string[] };
    expect(ctx.serviceable_slugs).not.toContain('openai');
    expect(ctx.serviceable_slugs).toContain('anthropic');
  });

  // ⛔ 2026-09-13: provider re-resolvovaného kandidáta se hádal `resolveProvider(top.model_id)`.
  // Id bez prefixu (alias lokálního modelu) vyšlo jako `openai` = TÝŽ provider, který právě
  // selhal → žádný alternativní dispatch, jen chyba. Provider patří z řádku resolveru.
  it('re-resolve na model registru BEZ prefixu jde k providerovi z řádku (vllm), ne k odhadu z id', async () => {
    const aChat = vi.fn(async (): Promise<ChatResponse> => {
      throw new Error('provider A down');
    });
    const vllmChat = vi.fn(async (req: ChatRequest) => okResponse('vllm', req.model));
    getRegistry().addBackend(stubBackend({ id: 'openai', serves: (m) => m.startsWith('gpt'), chat: aChat }));
    // vLLM stub „umí" jen prefix local-/vllm- — alias bez prefixu canServe NEsplní.
    getRegistry().addBackend(stubBackend({ id: 'vllm', serves: (m) => /^(local-|vllm-)/.test(m), chat: vllmChat }));
    installRpc({ provider_slug: 'vllm-local', backend_kind: 'local_vllm', model_id: 'default-lens' });

    const result = await unifiedChat({ provider: 'openai', model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] });

    expect(result.provider).toBe('vllm');
    expect(vllmChat).toHaveBeenCalledTimes(1);
    expect(vllmChat.mock.calls[0][0].model).toBe('default-lens');
  });

  it('re-resolve: backend providera z řádku má přednost před shodou prefixu id (gpt-oss na vLLM)', async () => {
    const aChat = vi.fn(async (): Promise<ChatResponse> => {
      throw new Error('provider A down');
    });
    const vllmChat = vi.fn(async (req: ChatRequest) => okResponse('vllm', req.model));
    getRegistry().addBackend(stubBackend({ id: 'openai', serves: (m) => m.startsWith('gpt'), chat: aChat }));
    getRegistry().addBackend(stubBackend({ id: 'vllm', serves: (m) => /^(local-|vllm-)/.test(m), chat: vllmChat }));
    installRpc({ provider_slug: 'vllm-local', backend_kind: 'local_vllm', model_id: 'gpt-oss-20b' });

    const result = await unifiedChat({ provider: 'openai', model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] });

    expect(result.provider).toBe('vllm');
    expect(aChat).toHaveBeenCalledTimes(1); // jen původní pokus — alternativa se k OpenAI nevrátila
    expect(vllmChat.mock.calls[0][0].model).toBe('gpt-oss-20b');
  });

  it('DEFERS (throws — no hardcoded fallback) when the resolver finds no other suitable provider', async () => {
    const aChat = vi.fn(async (): Promise<ChatResponse> => {
      throw new Error('provider A down');
    });
    const bChat = vi.fn(async () => okResponse('anthropic', 'claude-x'));
    getRegistry().addBackend(stubBackend({ id: 'openai', serves: (m) => m.startsWith('gpt'), chat: aChat }));
    getRegistry().addBackend(stubBackend({ id: 'anthropic', serves: (m) => m.startsWith('claude'), chat: bChat }));

    installRpc(null); // resolver returns nothing → defer, never invent a model

    await expect(
      unifiedChat({ provider: 'openai', model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/provider A down|All backends failed/);

    // The failure was still recorded (reactive feedback fires before the defer)…
    expect(rpcCalls.find((c) => c.fn === 'record_provider_health_result')).toBeDefined();
    // …the resolver WAS consulted, returned nothing, and NO alternative was dispatched.
    expect(rpcCalls.find((c) => c.fn === 'aisha_resolve_clow_backend')).toBeDefined();
    expect(bChat).not.toHaveBeenCalled();
  });

  it('short-circuits the resolver when the only serviceable provider is the failed one (serviceable MINUS failed = ∅)', async () => {
    const aChat = vi.fn(async (): Promise<ChatResponse> => {
      throw new Error('provider A down');
    });
    // Only A registered → after excluding A there is nothing serviceable, so reResolveExcluding
    // returns null WITHOUT calling the resolver (no point asking — and no fabricated model).
    getRegistry().addBackend(stubBackend({ id: 'openai', serves: (m) => m.startsWith('gpt'), chat: aChat }));

    installRpc({ provider_slug: 'anthropic', model_id: 'claude-x' }); // would succeed, but must NOT be reached

    await expect(
      unifiedChat({ provider: 'openai', model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/provider A down|All backends failed/);

    expect(rpcCalls.find((c) => c.fn === 'record_provider_health_result')).toBeDefined();
    expect(rpcCalls.find((c) => c.fn === 'aisha_resolve_clow_backend')).toBeUndefined();
  });
});
