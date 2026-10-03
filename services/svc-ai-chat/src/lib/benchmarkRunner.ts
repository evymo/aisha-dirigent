/**
 * Benchmark runner — the real quality eval (beyond the smoke self-test). For each model
 * it runs the task suite via unifiedChat, scores each response (heuristic + optional
 * judge), aggregates per (model, task_type), and records ONE current row via
 * record_model_benchmark (replace semantics). The aggregate 'chat' overall_score then
 * feeds aisha_resolve_clow_backend + get_adaptive_model_tiers ranking. Soft per model.
 *
 * Injected rpc + chat + judge make it unit-testable and provider-agnostic.
 */
import { unifiedChat, selectServiceableProviderForms, providerForRegistryRow } from './llmRouter.js';
import { journalDispatch } from './dispatchJournal.js';
import { scoreTask, aggregateScores, type BenchmarkTask, type JudgeFn } from './benchmarkScorer.js';
import { BENCHMARK_TASKS } from './benchmarkTaskSuite.js';

export type BenchmarkRpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;
export type BenchmarkChat = (opts: {
  provider: string;
  model: string;
  messages: Array<{ role: 'user'; content: string }>;
}) => Promise<{ text: string; usage?: { inputTokens?: number; outputTokens?: number } }>;

export interface BenchmarkModel {
  id: string;
  provider: string;
  model_id: string;
}

export interface BenchmarkRunResult {
  evalRunId: string | null;
  modelsBenchmarked: number;
  perModel: Array<{ modelId: string; taskType: string; overall: number; sampleCount: number }>;
}

const defaultChat: BenchmarkChat = async (opts) => {
  const provider = providerForRegistryRow(opts.provider);
  if (!provider) throw new Error(`benchmark: provider "${opts.provider}" nemá backend — nelze měřit`);
  await journalDispatch({ model: opts.model, provider, runtime: 'direct_llm', reason: 'model-benchmark' });
  // pinProvider: skóre patří TOMUHLE (provider, model) — žádný fallback na jiný model,
  // jehož odpověď by se připsala měřenému (viz UnifiedChatOptions.pinProvider).
  const r = await unifiedChat({ provider, model: opts.model, messages: opts.messages, pinProvider: true });
  return { text: r.text, usage: r.usage };
};

/** Build an LLM-as-judge from a (trusted, derived) judge model + a chat fn. */
export function makeLlmJudge(judgeModel: { provider: string; model_id: string }, chat: BenchmarkChat = defaultChat): JudgeFn {
  return async ({ prompt, response, rubric }) => {
    const judgePrompt =
      `You are a strict evaluator. Rate the ASSISTANT RESPONSE to the USER PROMPT on four dimensions, each 0.0 to 1.0.\n` +
      `USER PROMPT: ${prompt}\nASSISTANT RESPONSE: ${response}\n${rubric ? `RUBRIC: ${rubric}\n` : ''}` +
      `Reply with ONLY a compact JSON object: {"relevance":<0-1>,"groundedness":<0-1>,"safety":<0-1>,"coherence":<0-1>}`;
    const res = await chat({
      provider: judgeModel.provider,
      model: judgeModel.model_id,
      messages: [{ role: 'user', content: judgePrompt }],
    });
    const parsed = JSON.parse(res.text.replace(/```(?:json)?/gi, '').trim()) as Record<string, unknown>;
    return {
      relevance: Number(parsed.relevance),
      groundedness: Number(parsed.groundedness),
      safety: Number(parsed.safety),
      coherence: Number(parsed.coherence),
    };
  };
}

function groupByTaskType(tasks: BenchmarkTask[]): Map<string, BenchmarkTask[]> {
  const m = new Map<string, BenchmarkTask[]>();
  for (const t of tasks) {
    const arr = m.get(t.task_type);
    if (arr) arr.push(t);
    else m.set(t.task_type, [t]);
  }
  return m;
}

/**
 * Benchmark each model across the task suite. `models` is the set to benchmark (the
 * route supplies the available chat-capable models). Non-serviceable providers are
 * skipped (no key here → can't probe). Returns the eval-run id + per-model overalls.
 */
export async function benchmarkModels(
  rpc: BenchmarkRpc,
  models: BenchmarkModel[],
  opts: { tasks?: BenchmarkTask[]; chat?: BenchmarkChat; judge?: JudgeFn; serviceableProviders?: ReadonlySet<string> } = {},
): Promise<BenchmarkRunResult> {
  const tasks = opts.tasks ?? BENCHMARK_TASKS;
  const chat = opts.chat ?? defaultChat;
  // Serviceable provider forms (BOTH slug + backend-id) this process can reach. The model rows
  // store the backend-id form (e.g. 'google') while the slug form ('google-genai') drives the
  // resolver — accept either so google/gemini models are not skipped. Derived from live backends.
  const serviceable = opts.serviceableProviders ?? new Set(selectServiceableProviderForms());
  const byType = groupByTaskType(tasks);

  // Group this run (soft — a missing eval-run never blocks the benchmark itself).
  let evalRunId: string | null = null;
  try {
    evalRunId = (await rpc('create_eval_run_admin', {
      p_metadata: { source: 'model-benchmark', tasks: tasks.length, models: models.length },
      p_trigger_type: 'admin-benchmark',
    })) as string;
  } catch {
    evalRunId = null;
  }

  const perModel: BenchmarkRunResult['perModel'] = [];
  let modelsBenchmarked = 0;

  for (const m of models) {
    if (serviceable.size > 0 && !serviceable.has(m.provider)) continue;
    let touched = false;

    for (const [taskType, group] of byType) {
      const scores = [];
      let latencyTotal = 0;
      let inTok = 0;
      let outTok = 0;
      let ok = 0;
      for (const task of group) {
        const t0 = Date.now();
        let response = '';
        try {
          // Provider z řádku registru (odkud byl model objeven), ne odhad z id —
          // alias lokálního modelu by jinak skončil u `openai` (naměřeno 2026-09-13).
          const res = await chat({
            provider: m.provider,
            model: m.model_id,
            messages: [{ role: 'user', content: task.prompt }],
          });
          response = res.text ?? '';
          inTok += res.usage?.inputTokens ?? 0;
          outTok += res.usage?.outputTokens ?? 0;
          ok += 1;
        } catch {
          response = ''; // unreachable model → scored as a miss, never throws
        }
        latencyTotal += Date.now() - t0;
        scores.push(await scoreTask(task, response, opts.judge));
      }

      const agg = aggregateScores(scores);
      const n = group.length;
      await rpc('record_model_benchmark', {
        p_avg_cost_per_call: null,
        p_avg_latency_ms: Math.round(latencyTotal / Math.max(n, 1)),
        p_avg_tokens_input: Math.round(inTok / Math.max(n, 1)),
        p_avg_tokens_output: Math.round(outTok / Math.max(n, 1)),
        p_coherence: agg.coherence,
        p_eval_run_id: evalRunId,
        p_groundedness: agg.groundedness,
        p_model_registry_id: m.id,
        p_overall: agg.overall,
        p_relevance: agg.relevance,
        p_safety: agg.safety,
        p_sample_count: n,
        p_success_rate: ok / Math.max(n, 1),
        p_task_type: taskType,
      });
      perModel.push({ modelId: m.model_id, taskType, overall: agg.overall, sampleCount: n });
      touched = true;
    }

    if (touched) modelsBenchmarked += 1;
  }

  return { evalRunId, modelsBenchmarked, perModel };
}
