/**
 * Model self-test runner — "AISHA self-tests the models it discovered". Closes the
 * loop after discovery (PR-C) + moderation (PR-D): a discovered model is
 * eval_status='pending' and resolvable, but unproven. This probes each pending model
 * with a tiny smoke prompt and records the verdict via record_model_self_test, which
 * transitions pending → 'tested' (responded) / 'rejected' (failed). A rejected model
 * is then excluded by the resolver moderation.
 *
 * Injected rpc + chat make it unit-testable and provider-agnostic.
 */
import { unifiedChat, getAllBackends, providerForRegistryRow } from './llmRouter.js';
import { journalDispatch } from './dispatchJournal.js';
import { deriveModelCaps } from './modelDiscovery.js';

export type SelfTestRpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;
export type SelfTestChat = (opts: {
  /** `ai_model_registry.provider` řádku — provider, ze kterého byl model objeven. */
  provider: string;
  model: string;
  messages: Array<{ role: 'user'; content: string }>;
}) => Promise<{ text: string }>;

export interface SelfTestRunResult {
  tested: number;
  passed: number;
  failed: number;
}

const defaultChat: SelfTestChat = async (opts) => {
  const provider = providerForRegistryRow(opts.provider);
  if (!provider) throw new Error(`self-test: provider "${opts.provider}" nemá backend — nelze měřit`);
  // I1 — a self-test smoke call IS a model dispatch: journal it (ai_decisions) before
  // the raw call so AISHA's authority holds uniformly; journal failure stops the probe.
  await journalDispatch({ model: opts.model, provider, runtime: 'direct_llm', reason: 'model-self-test.smoke' });
  // pinProvider: měří se TENHLE model u TOHOTO providera — viz UnifiedChatOptions.pinProvider.
  return unifiedChat({ provider, model: opts.model, messages: opts.messages, pinProvider: true });
};

/**
 * Smoke-test every discovered-but-untested model and record the verdict.
 * Soft per-model: one model's failure becomes a 'rejected' verdict, never an
 * uncaught throw that aborts the run.
 */
export async function selfTestModels(
  rpc: SelfTestRpc,
  chat: SelfTestChat = defaultChat,
  opts: { limit?: number; serviceableProviders?: ReadonlySet<string>; mode?: 'pending' | 'rejected-only' | 'all-settled' } = {},
): Promise<SelfTestRunResult> {
  // Only test a model whose provider this process actually holds a key for —
  // otherwise unifiedChat fails for lack of a key and we'd WRONGLY reject a valid
  // model. A non-serviceable provider's models stay 'pending' until a process that
  // can reach them tests them.
  const serviceable = opts.serviceableProviders ?? new Set(getAllBackends().map((b) => b.id));
  // A re-test mode (rejected-only / all-settled) forces the verdict to overwrite a
  // settled 'rejected' model; the default boot path ('pending') never forces.
  const force = !!opts.mode && opts.mode !== 'pending';

  const due = ((await rpc('get_models_due_self_test', { p_limit: opts.limit ?? 25, p_mode: opts.mode ?? 'pending' })) ?? []) as Array<{
    id: string;
    provider: string;
    model_id: string;
  }>;

  const result: SelfTestRunResult = { tested: 0, passed: 0, failed: 0 };

  for (const m of due) {
    if (serviceable.size > 0 && !serviceable.has(m.provider)) continue; // can't test what we can't reach
    // Capability-derived gate: the smoke IS a chat completion, so only chat-capable models
    // can pass it. Probing a non-chat model (embedding/tts/whisper/dall-e/…) with a chat
    // prompt returns a provider 4xx that the dispatch's record_provider_health misreads as a
    // PROVIDER outage — it FALSELY marks the whole provider down (proved live: openai 13×
    // on text-embedding-*), so AISHA then wrongly excludes a healthy provider. Non-chat
    // models are capability-known from discovery; they need their own probe (the embedding
    // endpoint, a follow-up), never the chat smoke. Derive from the id, never an allow-list.
    if (!deriveModelCaps(m.model_id).is_chat_capable) continue;
    const t0 = Date.now();
    let passed = false;
    try {
      // ⛔ Provider z ŘÁDKU registru, ne odhad z id. `resolveProvider('default-lens')`
      // vrátil `openai` (alias lokálního modelu nemá prefix), takže model objevený na
      // vLLM se testoval u OpenAI a byl odmítnut (naměřeno 2026-09-13).
      const res = await chat({
        provider: m.provider,
        model: m.model_id,
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      });
      passed = typeof res.text === 'string' && res.text.trim().length > 0;
    } catch {
      passed = false; // unreachable / errored model → rejected
    }
    const latency = Date.now() - t0;

    await rpc('record_model_self_test', {
      p_avg_latency_ms: latency,
      p_force: force,
      p_model_registry_id: m.id,
      p_overall: passed ? 0.7 : 0,
      p_passed: passed,
      p_task_type: 'smoke',
    });

    result.tested += 1;
    if (passed) result.passed += 1;
    else result.failed += 1;
  }

  return result;
}
