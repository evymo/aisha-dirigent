/**
 * Contextual retrieval (Anthropic pattern) — prefix generator (Step 1 of
 * retrieval optimization plan 2026).
 *
 * For each chunk, asks a small/cheap LLM to produce a 1–2 sentence context
 * describing how the chunk sits within the parent document. The prefix is
 * prepended to the chunk text before embedding:
 *
 *     embedding_input = `${contextual_prefix} ${chunk_text}`
 *
 * Anthropic published this pattern with a measured −67% failure rate vs
 * embedding chunks in isolation. The cause of the original failure mode is
 * obvious in hindsight: a chunk "Lhůta je 14 dní od převzetí." in isolation
 * has no signal that it belongs to contract CS-2024-082 with client Acme;
 * the prefix carries that signal into the embedding space, so semantic
 * search disambiguates between similarly-worded chunks across documents.
 *
 * Design choices:
 *   - Prompt asks for "return ONLY the context sentence(s), no preamble" so
 *     parsing is just `.trim()`. JSON mode is overkill here.
 *   - Body excerpt is truncated to ~6000 chars (≈1500 tokens) to keep prompt
 *     cost bounded even for very long parent documents.
 *   - Brick4 locale axis: the context is written IN THE CHUNK'S LANGUAGE so an
 *     English prefix never poisons a non-English chunk's multilingual embedding.
 *   - Fail-loud (HARD invariant): the model MUST be resolver-supplied (opts.model
 *     from aisha_resolve_clow_backend) — there is no hardcoded/env default. On a
 *     persistent LLM failure or an empty completion this THROWS; the caller marks
 *     that one item/chunk failed and re-queues it. A chunk is NEVER embedded
 *     without its prefix (an unprefixed embedding would silently degrade the space).
 */
import { chatCompletionWithRetry, LlmCompletionError } from './llm-completion.js';

const DEFAULT_BODY_EXCERPT_CHARS = 6000;
const DEFAULT_MAX_TOKENS = 120;

export interface PrefixInput {
  /** Parent knowledge_item title. */
  item_title: string;
  /** Parent body_markdown (will be truncated). */
  item_body_markdown: string;
  /** Section heading the chunk belongs to (may be null). */
  section_title: string | null;
  /** The chunk text itself. */
  chunk_text: string;
  /**
   * BCP47 locale of the chunk (Brick3 axis). The context sentence is written in
   * this language so the prefix embeds into the same multilingual neighbourhood
   * as the chunk. The 'global' sentinel (or omitted) keeps the prior
   * English-default behaviour.
   */
  locale?: string;
}

export interface PrefixResult {
  /** The generated 1–2 sentence context, trimmed. */
  prefix: string;
  /** Model id that produced the prefix. */
  model: string;
  /** Model version reported by provider (or input version). */
  model_version: string;
  /** Total tokens consumed for this generation. */
  token_count: number;
  /** Latency in ms. */
  latency_ms: number;
}

export interface PrefixOptions {
  /**
   * The resolver-chosen model id. REQUIRED at call time — AISHA resolves the
   * contextual-prefix backend (aisha_resolve_clow_backend / rag.contextual_prefix)
   * and passes its model_id here. There is no hardcoded or env default; a missing
   * model is a fail-loud error, never a silent fallback to a baked-in model.
   */
  model?: string;
  /** Override version string (used for the audit row). */
  model_version?: string;
  /** Override max output tokens (default 120). */
  max_tokens?: number;
  /** Override body excerpt char limit (default 6000). */
  body_excerpt_chars?: number;
  /** Override LLM endpoint base URL (resolved via capability-resolver). */
  base_url?: string;
  /** Override LLM API key (resolved via capability-resolver — read from env). */
  api_key?: string;
  /** ai_provider_registry.slug of the resolved backend — selects native vs OpenAI-compat dispatch. */
  provider_slug?: string;
  /**
   * `ai_provider_registry.auth_env_var` — `null` znamená, že backend autentizaci
   * nemá (instanční model). Propouští se beze změny do chatCompletion, kde o
   * povinnosti klíče rozhoduje; bez toho lokální backend spadl na 503.
   */
  auth_env_var?: string | null;
}

/**
 * Resolve a BCP47 locale to its English language name for the prefix-language
 * instruction (e.g. 'cs' → 'Czech'). Returns null for the 'global' sentinel, an
 * empty/missing locale, or any code Intl cannot resolve — the caller then omits
 * the language constraint (English-default). Exported for unit tests.
 */
export function localeLanguageName(locale: string | undefined | null): string | null {
  if (!locale || locale === 'global') return null;
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(locale);
    // Intl echoes the input back for unknown codes — treat that as unresolved.
    return name && name.toLowerCase() !== locale.toLowerCase() ? name : null;
  } catch {
    return null;
  }
}

/**
 * Build the Anthropic-style contextual prefix prompt. Exported for unit tests.
 */
export function buildPrefixPrompt(input: PrefixInput, opts: PrefixOptions = {}): { system: string; user: string } {
  const excerptChars = opts.body_excerpt_chars ?? DEFAULT_BODY_EXCERPT_CHARS;
  const bodyExcerpt = (input.item_body_markdown ?? '').slice(0, excerptChars);
  const section = input.section_title?.trim() || 'main';
  // Brick4: write the context in the chunk's own language so it embeds into the
  // same multilingual neighbourhood as the chunk. 'global'/unknown ⇒ no constraint
  // (English-default, prior behaviour).
  const languageName = localeLanguageName(input.locale);
  const languageClause = languageName
    ? ` Write the context sentence(s) in ${languageName} (the chunk's language) — never translate to another language.`
    : '';

  const system =
    'You are a precise indexing assistant. For each chunk you receive, you produce a 1–2 sentence context ' +
    'describing how the chunk fits in its parent document. The context must be specific (names, references, ' +
    'section) — not generic ("this is about X"). Return ONLY the context sentence(s), with no preamble, ' +
    'no numbering, no markdown.' + languageClause;

  const user =
    `Document title: ${input.item_title}\n` +
    `Section: ${section}\n` +
    `Document excerpt (truncated to ${excerptChars} chars):\n${bodyExcerpt}\n\n` +
    `Chunk:\n${input.chunk_text}\n\n` +
    `Write the 1–2 sentence context for this chunk:`;

  return { system, user };
}

/**
 * Generate a contextual prefix for one chunk by calling the resolver-chosen LLM.
 *
 * Fail-loud: THROWS on a persistent LLM failure or an empty completion. The caller
 * marks that item/chunk failed and re-queues it — a chunk is never embedded without
 * its prefix. The model MUST be supplied by the caller (opts.model, resolved via
 * aisha_resolve_clow_backend); there is no hardcoded or env default.
 */
export async function generateContextualPrefix(
  input: PrefixInput,
  opts: PrefixOptions = {},
): Promise<PrefixResult> {
  const model = opts.model;
  if (!model || model.trim().length === 0) {
    throw new Error(
      'generateContextualPrefix: opts.model is required — the contextual-prefix backend ' +
        'must be resolved via aisha_resolve_clow_backend (rag.contextual_prefix). ' +
        'No hardcoded model default (fail-loud; AISHA selects the model).',
    );
  }
  const modelVersion = opts.model_version ?? 'unknown';
  const maxTokens = opts.max_tokens ?? DEFAULT_MAX_TOKENS;

  const { system, user } = buildPrefixPrompt(input, opts);

  const completion = await chatCompletionWithRetry({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0,
    max_tokens: maxTokens,
    base_url: opts.base_url,
    api_key: opts.api_key,
    auth_env_var: opts.auth_env_var,
    provider_slug: opts.provider_slug,
  });
  const prefix = completion.text.trim();
  if (prefix.length === 0) {
    // An empty completion is a failure, not a usable prefix — fail loud so the
    // caller re-queues rather than embedding the chunk bare.
    throw new LlmCompletionError(502, `contextual prefix model ${model} returned an empty completion`);
  }
  return {
    prefix,
    model: completion.model,
    model_version: modelVersion,
    token_count: completion.usage.total_tokens,
    latency_ms: completion.latency_ms,
  };
}
