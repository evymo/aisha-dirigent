/**
 * RAGAS-style LLM-as-judge metrics, reimplemented in TypeScript.
 *
 * Four metrics, each scored 0–1, computed independently per eval run:
 *
 *   - faithfulness        : Are answer claims supported by the retrieved context?
 *   - answer_relevancy    : Does the answer address the question?
 *   - context_precision   : What % of retrieved chunks were relevant?
 *   - context_recall      : What % of needed information was retrieved?
 *
 * Why reimplemented in TS instead of using the python ragas package:
 *   AISHA is TypeScript + Fastify end-to-end. A python sidecar adds an extra
 *   service, container, deploy path, and breaks the single-language CI gate.
 *   LLM-as-judge is a thin shim over chat-completion + JSON parsing — there is
 *   no library "secret sauce" to lose by porting.
 *
 * Determinism:
 *   All judge calls use temperature=0 and json_mode=true. The same (judge_model,
 *   prompt, inputs) tuple should yield the same score. Caller is responsible
 *   for pinning judge_model in batch metadata so scores are comparable across
 *   runs (otherwise upgrading the judge model causes an apparent regression).
 *
 * Cost-aware design:
 *   - context_precision / context_recall short-circuit to deterministic
 *     set-based scoring when expected_chunk_slugs is provided. This skips
 *     2 LLM calls per eval run when the golden record is precise.
 *   - faithfulness is the single most expensive call (longest context). All
 *     other metrics use compact inputs.
 */
import { chatCompletionWithRetry, type ChatMessage } from './llm-completion.js';
import { slugMatches } from './rag-retrieval-metrics.js';

export interface RetrievedChunk {
  id: string;
  text: string;
  /** Optional slug/label used for set-based recall when ground truth lists expected slugs. */
  slug?: string | null;
}

export interface JudgeInput {
  question: string;
  generated_answer: string;
  ground_truth_answer: string;
  retrieved_chunks: RetrievedChunk[];
  expected_chunk_slugs: string[];
  /** vLLM model id, e.g. "Qwen/Qwen3-30B" or "gpt-4o-mini". */
  judge_model: string;
  /** Optional override for the judge LLM endpoint (resolved via capability-resolver). */
  judge_base_url?: string;
  /** Optional override for the judge LLM API key. */
  judge_api_key?: string;
  /** ai_provider_registry.slug of the resolved judge backend — selects native vs OpenAI-compat dispatch. */
  judge_provider_slug?: string;
  /**
   * ai_provider_registry.auth_env_var of the resolved judge backend (null = no
   * auth). Without it the client may not pick a key for the judge endpoint —
   * see resolveApiKey in llm-completion.ts.
   */
  judge_auth_env_var?: string | null;
}

export interface RagScores {
  faithfulness: number;
  answer_relevancy: number;
  context_precision: number;
  context_recall: number;
}

export interface RagScoresWithMeta extends RagScores {
  /** Total tokens spent across all judge calls. */
  judge_tokens_total: number;
  /** Total LLM-as-judge latency in milliseconds. */
  judge_latency_ms_total: number;
  /** Reasoning strings per metric (audit + debug). */
  reasoning: {
    faithfulness?: string;
    answer_relevancy?: string;
    context_precision?: string;
    context_recall?: string;
  };
  /** Whether precision/recall used the deterministic set-based path. */
  set_based_precision: boolean;
  set_based_recall: boolean;
}

interface JudgeJsonResponse {
  score: number;
  reasoning?: string;
}

function clamp01(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return Math.round(v * 1000) / 1000;
}

function parseJudgeJson(raw: string): JudgeJsonResponse {
  // vLLM with json_mode usually returns clean JSON; some models wrap in ```json```
  const cleaned = raw.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`judge returned non-JSON: ${raw.slice(0, 200)}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('judge returned non-object JSON');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.score !== 'number' && typeof obj.score !== 'string') {
    throw new Error(`judge JSON missing numeric "score" field`);
  }
  return {
    score: clamp01(obj.score),
    reasoning: typeof obj.reasoning === 'string' ? obj.reasoning.slice(0, 500) : undefined,
  };
}

function formatChunks(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return '(no chunks retrieved)';
  return chunks
    .slice(0, 20)
    .map((c, i) => `[chunk ${i + 1}${c.slug ? ` · ${c.slug}` : ''}]\n${c.text.slice(0, 1500)}`)
    .join('\n\n');
}

// ──────────────────────────────────────────────────────────────────────────
// Metric 1 — Faithfulness
// ──────────────────────────────────────────────────────────────────────────

const FAITHFULNESS_SYSTEM: ChatMessage = {
  role: 'system',
  content:
    'You are a strict evaluator of generated answers against retrieved context. ' +
    'You return only JSON with fields {"score": <number 0..1>, "reasoning": "<short>"} — no preamble, no markdown.',
};

function faithfulnessUser(input: JudgeInput): ChatMessage {
  return {
    role: 'user',
    content:
      `Task: Score the FAITHFULNESS of the generated answer to the retrieved context. ` +
      `Faithfulness = 1.0 means every factual claim in the answer is directly supported by the context. ` +
      `0.0 means the answer contradicts the context or is fabricated. ` +
      `Partial credit: count supported claims / total claims.\n\n` +
      `Question:\n${input.question}\n\n` +
      `Retrieved context:\n${formatChunks(input.retrieved_chunks)}\n\n` +
      `Generated answer:\n${input.generated_answer}\n\n` +
      `Return JSON only.`,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Metric 2 — Answer Relevancy
// ──────────────────────────────────────────────────────────────────────────

const ANSWER_RELEVANCY_SYSTEM: ChatMessage = {
  role: 'system',
  content:
    'You evaluate whether a generated answer addresses the user question. ' +
    'You return only JSON {"score": <number 0..1>, "reasoning": "<short>"}.',
};

function answerRelevancyUser(input: JudgeInput): ChatMessage {
  return {
    role: 'user',
    content:
      `Task: Score how directly the generated answer addresses the question. ` +
      `1.0 = answer fully addresses the question. ` +
      `0.5 = partially on-topic / hedged / incomplete. ` +
      `0.0 = off-topic / refusal / non-answer.\n\n` +
      `Ignore factual correctness for this metric — only judge relevancy.\n\n` +
      `Question:\n${input.question}\n\n` +
      `Generated answer:\n${input.generated_answer}\n\n` +
      `Return JSON only.`,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Metric 3 — Context Precision (LLM fallback when no expected slugs)
// ──────────────────────────────────────────────────────────────────────────

const CONTEXT_PRECISION_SYSTEM: ChatMessage = {
  role: 'system',
  content:
    'You evaluate retrieval precision: what fraction of the retrieved chunks are relevant to the question. ' +
    'You return only JSON {"score": <number 0..1>, "reasoning": "<short>"}.',
};

function contextPrecisionUser(input: JudgeInput): ChatMessage {
  return {
    role: 'user',
    content:
      `Task: Compute context precision. Of the retrieved chunks below, what fraction is relevant to answering ` +
      `the question? Relevant means: the chunk contains information that would help a human answer the question. ` +
      `Score = (relevant chunks) / (total retrieved chunks). 1.0 = all relevant, 0.0 = none relevant.\n\n` +
      `Question:\n${input.question}\n\n` +
      `Retrieved chunks:\n${formatChunks(input.retrieved_chunks)}\n\n` +
      `Return JSON only.`,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Metric 4 — Context Recall (LLM fallback when no expected slugs)
// ──────────────────────────────────────────────────────────────────────────

const CONTEXT_RECALL_SYSTEM: ChatMessage = {
  role: 'system',
  content:
    'You evaluate retrieval recall: whether the retrieved context contains the information needed to produce the ground-truth answer. ' +
    'You return only JSON {"score": <number 0..1>, "reasoning": "<short>"}.',
};

function contextRecallUser(input: JudgeInput): ChatMessage {
  return {
    role: 'user',
    content:
      `Task: Compute context recall. Given the ground-truth answer and the retrieved chunks below, ` +
      `what fraction of the factual claims in the ground-truth answer is supported by the retrieved chunks? ` +
      `1.0 = all needed information present in chunks, 0.0 = none present.\n\n` +
      `Question:\n${input.question}\n\n` +
      `Ground-truth answer:\n${input.ground_truth_answer}\n\n` +
      `Retrieved chunks:\n${formatChunks(input.retrieved_chunks)}\n\n` +
      `Return JSON only.`,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Scoring runner
// ──────────────────────────────────────────────────────────────────────────

async function runJudge(
  system: ChatMessage,
  user: ChatMessage,
  judgeModel: string,
  baseUrl?: string,
  apiKey?: string,
  providerSlug?: string,
  authEnvVar?: string | null,
): Promise<{ score: number; reasoning?: string; tokens: number; latency_ms: number }> {
  const res = await chatCompletionWithRetry({
    model: judgeModel,
    messages: [system, user],
    temperature: 0,
    max_tokens: 512,
    json_mode: true,
    base_url: baseUrl,
    api_key: apiKey,
    auth_env_var: authEnvVar,
    provider_slug: providerSlug,
  });
  const parsed = parseJudgeJson(res.text);
  return {
    score: parsed.score,
    reasoning: parsed.reasoning,
    tokens: res.usage.total_tokens,
    latency_ms: res.latency_ms,
  };
}

// Shoda retrieved slugu s golden labelem má JEDNU definici (rag-retrieval-metrics.ts) —
// sdílí ji set-based metriky tady i rank-aware skóre (nDCG), podle kterého se vybírá
// embedding model. Re-export drží dosavadní import `slugMatches` z tohoto modulu.
export { slugMatches };

function setBasedPrecision(retrievedSlugs: string[], expectedSlugs: string[]): number {
  if (retrievedSlugs.length === 0) return 0;
  const hits = retrievedSlugs.filter((r) => expectedSlugs.some((e) => slugMatches(r, e))).length;
  return clamp01(hits / retrievedSlugs.length);
}

function setBasedRecall(retrievedSlugs: string[], expectedSlugs: string[]): number {
  if (expectedSlugs.length === 0) return 0;
  const hits = expectedSlugs.filter((e) => retrievedSlugs.some((r) => slugMatches(r, e))).length;
  return clamp01(hits / expectedSlugs.length);
}

/**
 * Score one eval run across all four RAGAS-style metrics.
 *
 * Returns {scores, reasoning, token/latency totals, set-based flags}. Caller
 * (the /rag/eval/run endpoint) persists these via fn_record_rag_eval_run_audited.
 */
export async function scoreEvalRun(input: JudgeInput): Promise<RagScoresWithMeta> {
  const retrievedSlugs = input.retrieved_chunks.map((c) => c.slug).filter((s): s is string => !!s);
  const useSetBased = input.expected_chunk_slugs.length > 0 && retrievedSlugs.length > 0;

  // Faithfulness + answer_relevancy always go through LLM judge — they need
  // claim-level reasoning that set membership can't capture.
  const [fRes, arRes] = await Promise.all([
    runJudge(FAITHFULNESS_SYSTEM, faithfulnessUser(input), input.judge_model, input.judge_base_url, input.judge_api_key, input.judge_provider_slug, input.judge_auth_env_var),
    runJudge(ANSWER_RELEVANCY_SYSTEM, answerRelevancyUser(input), input.judge_model, input.judge_base_url, input.judge_api_key, input.judge_provider_slug, input.judge_auth_env_var),
  ]);

  let cpScore: number;
  let crScore: number;
  let cpReasoning: string | undefined;
  let crReasoning: string | undefined;
  let cpTokens = 0;
  let cpLatency = 0;
  let crTokens = 0;
  let crLatency = 0;

  if (useSetBased) {
    cpScore = setBasedPrecision(retrievedSlugs, input.expected_chunk_slugs);
    crScore = setBasedRecall(retrievedSlugs, input.expected_chunk_slugs);
    cpReasoning = `set-based: ${retrievedSlugs.length} retrieved, ${input.expected_chunk_slugs.length} expected`;
    crReasoning = cpReasoning;
  } else {
    const [cpRes, crRes] = await Promise.all([
      runJudge(CONTEXT_PRECISION_SYSTEM, contextPrecisionUser(input), input.judge_model, input.judge_base_url, input.judge_api_key, input.judge_provider_slug, input.judge_auth_env_var),
      runJudge(CONTEXT_RECALL_SYSTEM, contextRecallUser(input), input.judge_model, input.judge_base_url, input.judge_api_key, input.judge_provider_slug, input.judge_auth_env_var),
    ]);
    cpScore = cpRes.score;
    crScore = crRes.score;
    cpReasoning = cpRes.reasoning;
    crReasoning = crRes.reasoning;
    cpTokens = cpRes.tokens;
    cpLatency = cpRes.latency_ms;
    crTokens = crRes.tokens;
    crLatency = crRes.latency_ms;
  }

  return {
    faithfulness: fRes.score,
    answer_relevancy: arRes.score,
    context_precision: cpScore,
    context_recall: crScore,
    judge_tokens_total: fRes.tokens + arRes.tokens + cpTokens + crTokens,
    judge_latency_ms_total: fRes.latency_ms + arRes.latency_ms + cpLatency + crLatency,
    reasoning: {
      faithfulness: fRes.reasoning,
      answer_relevancy: arRes.reasoning,
      context_precision: cpReasoning,
      context_recall: crReasoning,
    },
    set_based_precision: useSetBased,
    set_based_recall: useSetBased,
  };
}
