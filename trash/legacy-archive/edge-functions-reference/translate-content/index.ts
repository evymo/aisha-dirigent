/**
 * translate-content — LLM Translation Pipeline for Knowledge Base.
 *
 * Supports two content types:
 *   - `post`  → knowledge_post_translations (discussion posts)
 *   - `topic` → knowledge_topic_translations (topic versions / docs)
 *
 * Model routing:
 *   - gpt-5-mini: short text (<2000 chars), no code blocks
 *   - gpt-5: long text (≥2000 chars) or contains code blocks / tables
 *
 * Cache-first: checks source_hash to skip re-translation of unchanged content.
 * Metrics: records token_count, latency_ms, provider, model per translation.
 *
 * @module
 */
import { serve, createClient } from "../_shared/deps.ts";
import type { SupabaseClient } from "../_shared/deps.ts";
import { buildCorsHeaders, preflightResponse } from "../_shared/cors.ts";
import {
  resolveProvider,
  unifiedChat,
  type UnifiedChatResult,
} from "../_shared/llmRouter.ts";
import { getDefaultModel } from "../_shared/defaultModel.ts";

// ─── Model routing ───────────────────────────────────────────────────────────

const DEFAULT_MODEL = getDefaultModel();
const COMPLEXITY_CHAR_THRESHOLD = 2000;
const CODE_BLOCK_RE = /```[\s\S]+?```/;
const TABLE_RE = /\|.+\|.+\|/;

function chooseModel(_text: string): string {
  // Model selection is delegated to AISHA's router which validates availability.
  // All translation tasks use the single default model.
  return DEFAULT_MODEL;
}

// ─── Source hash (SHA-256 truncated) ─────────────────────────────────────────

async function computeSourceHash(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

// ─── Language name helper ────────────────────────────────────────────────────

const LANG_NAMES: Record<string, string> = {
  cs: "Czech",
  en: "English",
  de: "German",
  fr: "French",
  ru: "Russian",
  th: "Thai",
};

// ─── Translation core ────────────────────────────────────────────────────────

interface TranslationResult {
  text: string;
  model: string;
  provider: string;
  tokenCount: number;
  latencyMs: number;
}

async function translateText(
  sourceText: string,
  sourceLocale: string,
  targetLocale: string,
): Promise<TranslationResult> {
  const model = chooseModel(sourceText);
  const provider = resolveProvider(model);
  const sourceLang = LANG_NAMES[sourceLocale] ?? sourceLocale;
  const targetLang = LANG_NAMES[targetLocale] ?? targetLocale;

  const startMs = performance.now();

  const result: UnifiedChatResult = await unifiedChat({
    provider,
    model,
    systemPrompt: [
      `You are a professional translator specializing in technical documentation.`,
      `Translate from ${sourceLang} to ${targetLang}.`,
      `Preserve all Markdown formatting, code blocks, tables, and links exactly.`,
      `Do NOT add explanations. Return ONLY the translated text.`,
    ].join(" "),
    messages: [{ role: "user", content: sourceText }],
    temperature: 0.2,
    maxTokens: Math.max(4096, Math.ceil(sourceText.length * 1.5)),
  });

  const latencyMs = Math.round(performance.now() - startMs);

  if (!result.text?.trim()) {
    throw new Error(`Empty translation returned from ${model}`);
  }

  return {
    text: result.text.trim(),
    model,
    provider: result.provider,
    tokenCount: result.usage.inputTokens + result.usage.outputTokens,
    latencyMs,
  };
}

// ─── Content type handlers ───────────────────────────────────────────────────

interface TranslationOutput {
  locale: string;
  model: string;
  cached: boolean;
}

async function translatePost(
  supabase: SupabaseClient,
  postId: string,
  sourceText: string,
  sourceLocale: string,
  targetLocales: string[],
): Promise<TranslationOutput[]> {
  const sourceHash = await computeSourceHash(sourceText);
  const outputs: TranslationOutput[] = [];

  for (const locale of targetLocales) {
    // Cache check: existing translation with same source_hash
    const { data: existing } = await supabase
      .from("knowledge_post_translations")
      .select("id, source_hash")
      .eq("post_id", postId)
      .eq("locale", locale)
      .single();

    if (existing?.source_hash === sourceHash) {
      outputs.push({ locale, model: "cached", cached: true });
      continue;
    }

    const t = await translateText(sourceText, sourceLocale, locale);

    if (existing) {
      // Update existing with new translation
      await supabase
        .from("knowledge_post_translations")
        .update({
          body_translated: t.text,
          provider: t.provider,
          model: t.model,
          quality_score: null,
          is_human_reviewed: false,
          source_hash: sourceHash,
          token_count: t.tokenCount,
          latency_ms: t.latencyMs,
        })
        .eq("id", existing.id);
    } else {
      await supabase
        .from("knowledge_post_translations")
        .insert({
          post_id: postId,
          locale,
          body_translated: t.text,
          provider: t.provider,
          model: t.model,
          source_hash: sourceHash,
          token_count: t.tokenCount,
          latency_ms: t.latencyMs,
        });
    }

    outputs.push({ locale, model: t.model, cached: false });
  }

  return outputs;
}

async function translateTopicVersion(
  supabase: SupabaseClient,
  topicVersionId: string,
  sourceText: string,
  sourceLocale: string,
  targetLocales: string[],
): Promise<TranslationOutput[]> {
  const sourceHash = await computeSourceHash(sourceText);
  const outputs: TranslationOutput[] = [];

  for (const locale of targetLocales) {
    const { data: existing } = await supabase
      .from("knowledge_topic_translations")
      .select("id, source_hash")
      .eq("topic_version_id", topicVersionId)
      .eq("locale", locale)
      .single();

    if (existing?.source_hash === sourceHash) {
      outputs.push({ locale, model: "cached", cached: true });
      continue;
    }

    const t = await translateText(sourceText, sourceLocale, locale);

    if (existing) {
      await supabase
        .from("knowledge_topic_translations")
        .update({
          body_translated: t.text,
          provider: t.provider,
          model: t.model,
          quality_score: null,
          is_human_reviewed: false,
          source_hash: sourceHash,
          token_count: t.tokenCount,
          latency_ms: t.latencyMs,
        })
        .eq("id", existing.id);
    } else {
      await supabase
        .from("knowledge_topic_translations")
        .insert({
          topic_version_id: topicVersionId,
          locale,
          body_translated: t.text,
          provider: t.provider,
          model: t.model,
          source_hash: sourceHash,
          token_count: t.tokenCount,
          latency_ms: t.latencyMs,
        });
    }

    outputs.push({ locale, model: t.model, cached: false });
  }

  return outputs;
}

// ─── Main handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return preflightResponse(req, "*");
  }

  const corsHeaders = buildCorsHeaders(req, "*");
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status,
    });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const body = await req.json();

    // Support both legacy { record } and new { content_type, ... } format
    const contentType: string = body.content_type ?? "post";
    const targetLocales: string[] | undefined = body.target_locales;

    // Fetch supported locales from DB if not explicitly provided
    let locales: string[] = targetLocales ?? [];
    if (locales.length === 0) {
      const { data: langs } = await supabase
        .from("supported_languages")
        .select("code");
      locales = (langs ?? []).map((l: { code: string }) => l.code);
    }

    if (contentType === "topic") {
      // ── Topic version translation ──
      const { topic_version_id, source_text, source_locale } = body;
      if (!topic_version_id || !source_text) {
        return json({ error: "topic_version_id and source_text required" }, 400);
      }

      const targets = locales.filter((l) => l !== (source_locale ?? "cs"));
      const results = await translateTopicVersion(
        supabase,
        topic_version_id,
        source_text,
        source_locale ?? "cs",
        targets,
      );

      return json({ message: "Success", content_type: "topic", translations: results });
    }

    // ── Post translation (legacy + new) ──
    const record = body.record ?? body;
    if (!record?.body_original && !record?.source_text) {
      return json({ error: "body_original or source_text required" }, 400);
    }

    const postId = record.id ?? record.post_id;
    const sourceText = record.body_original ?? record.source_text;
    const sourceLocale = record.original_locale ?? record.source_locale ?? "en";

    if (!postId) {
      return json({ error: "post id required" }, 400);
    }

    const targets = locales.filter((l) => l !== sourceLocale);
    const results = await translatePost(supabase, postId, sourceText, sourceLocale, targets);

    return json({ message: "Success", content_type: "post", translations: results });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[translate-content] Error:", msg);
    return json({ error: msg }, 500);
  }
});
