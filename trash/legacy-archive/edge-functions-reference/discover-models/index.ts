/**
 * Edge function: discover-models
 *
 * Multi-provider model discovery — queries OpenAI, Anthropic, Google, and xAI
 * model APIs, upserts results into ai_model_registry, detects new models,
 * and optionally triggers eval runs + improvement proposals.
 *
 * Called by:
 *   - Scheduled n8n workflow (daily at 03:00 UTC)
 *   - Manual admin trigger
 *
 * Requires: service_role or admin JWT.
 *
 * @module
 */

import { serve, createClient, type SupabaseClient } from "../_shared/deps.ts";
import { preflightResponse, silentCorsDenyResponse } from "../_shared/cors.ts";
import { jsonResponse as jsonResponseBase } from "../_shared/http.ts";
import { corsGuard } from "../_shared/analyzeTrackingDocumentGuards.ts";
import { getAllowedOriginsRaw } from "../_shared/runtimeConfig.ts";

const allowedOriginsRaw = getAllowedOriginsRaw();

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200): Response {
  return jsonResponseBase(req, allowedOriginsRaw, body, status);
}

// ============================================================
// Types
// ============================================================

interface DiscoverRequest {
  /** Which providers to scan. Default: all configured. */
  providers?: string[];
  /** Whether to auto-trigger eval for new models. Default: true. */
  auto_eval?: boolean;
}

interface DiscoveredModel {
  provider: string;
  model_id: string;
  display_name: string | null;
  model_family: string | null;
  is_chat_capable: boolean;
  is_reasoning: boolean;
  is_vision: boolean;
  is_code_optimized: boolean;
  is_function_calling: boolean;
  context_window: number | null;
  max_output_tokens: number | null;
  input_price_per_m: number | null;
  output_price_per_m: number | null;
  provider_metadata: Record<string, unknown>;
}

interface ProviderResult {
  provider: string;
  models_found: number;
  new_models: string[];
  unavailable_marked: number;
  errors: string[];
}

// ============================================================
// Provider Scanning Functions
// ============================================================

/**
 * OpenAI: GET /v1/models → filter chat-capable models.
 */
async function scanOpenAI(apiKey: string): Promise<DiscoveredModel[]> {
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as { data: Array<{ id: string; created: number; owned_by: string }> };

  const CHAT_PREFIXES = ["gpt-", "o1-", "o3-", "o4-", "gpt-5"];
  const EXCLUDED = ["embedding", "whisper", "dall-e", "tts", "moderation", "davinci",
    "babbage", "curie", "ada", "realtime", "transcription", "search", "audio", "instruct"];

  return (data.data ?? [])
    .filter((m) => {
      const lower = m.id.toLowerCase();
      const hasPrefix = CHAT_PREFIXES.some((p) => lower.startsWith(p));
      const excluded = EXCLUDED.some((ex) => lower.includes(ex));
      return hasPrefix && !excluded;
    })
    .map((m) => ({
      provider: "openai" as const,
      model_id: m.id,
      display_name: formatModelName(m.id),
      model_family: extractFamily(m.id),
      is_chat_capable: true,
      is_reasoning: /^(o1|o3|o4|gpt-5)/i.test(m.id),
      is_vision: /gpt-4o|o4/i.test(m.id),
      is_code_optimized: false,
      is_function_calling: true,
      context_window: null, // OpenAI doesn't expose this in /v1/models
      max_output_tokens: null,
      input_price_per_m: null,
      output_price_per_m: null,
      provider_metadata: { owned_by: m.owned_by, created: m.created },
    }));
}

/**
 * Anthropic: no public /models endpoint — verify known models via Messages API ping.
 * We maintain a known list and verify availability.
 */
async function scanAnthropic(apiKey: string): Promise<DiscoveredModel[]> {
  // Anthropic known models — updated periodically
  const KNOWN_MODELS = [
    { id: "claude-sonnet-4-20250514", family: "claude-4", vision: true },
    { id: "claude-3-5-sonnet-20241022", family: "claude-3.5", vision: true },
    { id: "claude-3-5-haiku-20241022", family: "claude-3.5", vision: false },
    { id: "claude-3-opus-20240229", family: "claude-3", vision: true },
    { id: "claude-3-haiku-20240307", family: "claude-3", vision: false },
  ];

  const available: DiscoveredModel[] = [];

  for (const model of KNOWN_MODELS) {
    try {
      // Use a minimal request to verify model is available
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: model.id,
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
        signal: AbortSignal.timeout(10_000),
      });

      // 200 = available, 400 with "model" error = not available/deprecated
      if (response.ok || response.status === 429) {
        available.push({
          provider: "anthropic",
          model_id: model.id,
          display_name: formatModelName(model.id),
          model_family: model.family,
          is_chat_capable: true,
          is_reasoning: false,
          is_vision: model.vision,
          is_code_optimized: false,
          is_function_calling: true,
          context_window: 200000,
          max_output_tokens: model.family.includes("haiku") ? 8192 : 16384,
          input_price_per_m: null,
          output_price_per_m: null,
          provider_metadata: { verified_at: new Date().toISOString() },
        });

        // Consume body to free connection (don't await text if 200)
        await response.text().catch((_drainErr) => {/* noop — drain body to free connection */});
      } else {
        const body = await response.text().catch((_readErr) => "");
        // If 404 or explicit "model not found", skip
        if (response.status === 404 || body.includes("model")) {
          continue;
        }
        // Other errors (auth, etc.) — still consider available
        available.push({
          provider: "anthropic",
          model_id: model.id,
          display_name: formatModelName(model.id),
          model_family: model.family,
          is_chat_capable: true,
          is_reasoning: false,
          is_vision: model.vision,
          is_code_optimized: false,
          is_function_calling: true,
          context_window: 200000,
          max_output_tokens: model.family.includes("haiku") ? 8192 : 16384,
          input_price_per_m: null,
          output_price_per_m: null,
          provider_metadata: { verified_at: new Date().toISOString(), status: response.status },
        });
      }
    } catch (err) {
      // Timeout or network error — don't mark as available
      console.warn("[discover-models] model probe failed, skipping:", err);
      continue;
    }
  }

  return available;
}

/**
 * Google Gemini: GET /v1beta/models → filter generative models.
 */
async function scanGoogle(apiKey: string): Promise<DiscoveredModel[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    { signal: AbortSignal.timeout(15_000) },
  );

  if (!response.ok) {
    throw new Error(`Google AI API ${response.status}: ${await response.text()}`);
  }

  interface GoogleModel {
    name: string;
    displayName: string;
    description: string;
    inputTokenLimit: number;
    outputTokenLimit: number;
    supportedGenerationMethods: string[];
  }

  const data = (await response.json()) as { models: GoogleModel[] };

  return (data.models ?? [])
    .filter((m) =>
      m.supportedGenerationMethods?.includes("generateContent") &&
      m.name.includes("gemini"),
    )
    .map((m) => {
      // m.name = "models/gemini-2.5-flash" → extract "gemini-2.5-flash"
      const modelId = m.name.replace("models/", "");
      return {
        provider: "google" as const,
        model_id: modelId,
        display_name: m.displayName || formatModelName(modelId),
        model_family: extractFamily(modelId),
        is_chat_capable: true,
        is_reasoning: /gemini-2\.[5-9]|gemini-[3-9]/.test(modelId),
        is_vision: true, // All Gemini models support vision
        is_code_optimized: false,
        is_function_calling: true,
        context_window: m.inputTokenLimit || null,
        max_output_tokens: m.outputTokenLimit || null,
        input_price_per_m: null,
        output_price_per_m: null,
        provider_metadata: {
          description: m.description,
          generation_methods: m.supportedGenerationMethods,
        },
      };
    });
}

/**
 * xAI (Grok): GET /v1/models → OpenAI-compatible API.
 */
async function scanXAI(apiKey: string): Promise<DiscoveredModel[]> {
  const response = await fetch("https://api.x.ai/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`xAI API ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as { data: Array<{ id: string; created: number; owned_by: string }> };

  return (data.data ?? [])
    .filter((m) => /grok/i.test(m.id))
    .map((m) => ({
      provider: "xai" as const,
      model_id: m.id,
      display_name: formatModelName(m.id),
      model_family: extractFamily(m.id),
      is_chat_capable: true,
      is_reasoning: /grok-3(?!.*mini)/i.test(m.id), // grok-3 is reasoning, grok-3-mini too
      is_vision: false,
      is_code_optimized: false,
      is_function_calling: true,
      context_window: 131072,
      max_output_tokens: 16384,
      input_price_per_m: null,
      output_price_per_m: null,
      provider_metadata: { owned_by: m.owned_by, created: m.created },
    }));
}

// ============================================================
// Utilities
// ============================================================

/** Convert "gpt-5-mini" → "GPT-5 Mini" */
function formatModelName(id: string): string {
  return id
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/(\d{8,})/, "")
    .trim();
}

/** Extract model family: "gpt-5-mini" → "gpt-5", "claude-sonnet-4-20250514" → "claude-4" */
function extractFamily(id: string): string {
  // OpenAI: gpt-5-mini → gpt-5, o4-mini → o4
  const oaiMatch = id.match(/^(gpt-\d+|o\d+)/i);
  if (oaiMatch) return oaiMatch[1].toLowerCase();

  // Anthropic: claude-sonnet-4-YYYYMMDD → claude-4
  const claudeMatch = id.match(/claude-(?:\w+-)?([\d.]+)/i);
  if (claudeMatch) return `claude-${claudeMatch[1]}`;

  // Google: gemini-2.5-flash → gemini-2.5
  const geminiMatch = id.match(/gemini-([\d.]+)/i);
  if (geminiMatch) return `gemini-${geminiMatch[1]}`;

  // xAI: grok-3-mini → grok-3
  const grokMatch = id.match(/grok-(\d+)/i);
  if (grokMatch) return `grok-${grokMatch[1]}`;

  return id.split("-").slice(0, 2).join("-");
}

/**
 * Get API key for a provider from environment or vault.
 */
function getProviderKey(provider: string): string | null {
  switch (provider) {
    case "openai":
      return Deno.env.get("OPENAI_API_KEY") ?? null;
    case "anthropic":
      return Deno.env.get("ANTHROPIC_API_KEY") ?? null;
    case "google":
      return Deno.env.get("GOOGLE_AI_API_KEY") ?? null;
    case "xai":
      return Deno.env.get("XAI_API_KEY") ?? null;
    default:
      return null;
  }
}

// ============================================================
// Main Discovery Logic
// ============================================================

async function discoverProviderModels(
  provider: string,
  apiKey: string,
  supabase: SupabaseClient,
): Promise<ProviderResult> {
  const result: ProviderResult = {
    provider,
    models_found: 0,
    new_models: [],
    unavailable_marked: 0,
    errors: [],
  };

  let discovered: DiscoveredModel[] = [];

  try {
    switch (provider) {
      case "openai":
        discovered = await scanOpenAI(apiKey);
        break;
      case "anthropic":
        discovered = await scanAnthropic(apiKey);
        break;
      case "google":
        discovered = await scanGoogle(apiKey);
        break;
      case "xai":
        discovered = await scanXAI(apiKey);
        break;
      default:
        result.errors.push(`Unknown provider: ${provider}`);
        return result;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Scan failed: ${msg}`);
    return result;
  }

  result.models_found = discovered.length;

  // Upsert each discovered model
  for (const model of discovered) {
    try {
      const { data, error } = await supabase.rpc("upsert_discovered_model", {
        p_context_window: model.context_window,
        p_display_name: model.display_name,
        p_input_price_per_m: model.input_price_per_m,
        p_is_chat_capable: model.is_chat_capable,
        p_is_code_optimized: model.is_code_optimized,
        p_is_function_calling: model.is_function_calling,
        p_is_reasoning: model.is_reasoning,
        p_is_vision: model.is_vision,
        p_max_output_tokens: model.max_output_tokens,
        p_model_family: model.model_family,
        p_model_id: model.model_id,
        p_output_price_per_m: model.output_price_per_m,
        p_provider: model.provider,
        p_provider_metadata: model.provider_metadata,
      });

      if (error) {
        result.errors.push(`Upsert ${model.model_id}: ${error.message}`);
        continue;
      }

      if (data?.is_new) {
        result.new_models.push(model.model_id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Upsert ${model.model_id}: ${msg}`);
    }
  }

  // Mark models not in scan as unavailable
  try {
    const availableIds = discovered.map((m) => m.model_id);
    const { data: markedCount, error: markError } = await supabase.rpc("mark_models_unavailable", {
      p_available_model_ids: availableIds,
      p_provider: provider,
    });

    if (markError) {
      result.errors.push(`Mark unavailable: ${markError.message}`);
    } else {
      result.unavailable_marked = markedCount ?? 0;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Mark unavailable: ${msg}`);
  }

  return result;
}

// ============================================================
// HTTP Handler
// ============================================================

serve(async (req) => {
  // CORS
  const originFailure = corsGuard({
    origin: req.headers.get("Origin"),
    allowedOriginsRaw,
  });
  if (originFailure) return silentCorsDenyResponse();
  if (req.method === "OPTIONS") return preflightResponse(req, allowedOriginsRaw);
  if (req.method !== "POST") return jsonResponse(req, { error: "Method not allowed" }, 405);

  try {
    // Auth — service_role or admin
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return jsonResponse(req, { error: "Unauthorized" }, 401);
    }

    const token = authHeader.replace("Bearer ", "");

    // Use service role client for DB operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify caller is service_role or admin
    if (token !== supabaseServiceKey) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return jsonResponse(req, { error: "Unauthorized" }, 401);
      }
      const { data: isAdmin } = await supabase.rpc("has_role", {
        p_role: "admin",
        p_user_id: user.id,
      });
      if (!isAdmin) {
        return jsonResponse(req, { error: "Admin role required" }, 403);
      }
    }

    // Parse request
    let body: DiscoverRequest = {};
    try {
      body = (await req.json()) as DiscoverRequest;
    } catch {
      // Empty body OK — use defaults
    }

    const allProviders = ["openai", "anthropic", "google", "xai"];
    const requestedProviders = body.providers?.length
      ? body.providers.filter((p) => allProviders.includes(p))
      : allProviders;
    const autoEval = body.auto_eval !== false;

    // Run discovery for each provider concurrently
    const results: ProviderResult[] = [];
    const allNewModels: Array<{ provider: string; modelId: string }> = [];

    const promises = requestedProviders.map(async (provider) => {
      const apiKey = getProviderKey(provider);
      if (!apiKey) {
        results.push({
          provider,
          models_found: 0,
          new_models: [],
          unavailable_marked: 0,
          errors: [`No API key configured (${provider.toUpperCase()}_API_KEY)`],
        });
        return;
      }

      const result = await discoverProviderModels(provider, apiKey, supabase);
      results.push(result);

      for (const modelId of result.new_models) {
        allNewModels.push({ provider, modelId });
      }
    });

    await Promise.all(promises);

    // NOTE: Improvement proposal creation removed — channel-centric migration
    // dropped agent_configurations. New models are tracked in ai_model_registry
    // and auto-evaluated below. Proposals can be re-introduced via n8n workflow
    // when model comparison infrastructure is ready.
    const proposalsCreated = 0;

    // Auto-trigger eval run for new models
    let evalRunId: string | null = null;
    if (autoEval && allNewModels.length > 0) {
      try {
        const { data: runId, error: evalError } = await supabase.rpc("create_eval_run_admin", {
          p_agent_config_id: null, // Run against all golden examples
          p_metadata: {
            reason: "model_discovery",
            new_models: allNewModels.map((m) => `${m.provider}/${m.modelId}`),
            discovery_timestamp: new Date().toISOString(),
          },
          p_trigger_type: "scheduled",
        });
        if (evalError) {
          results[0]?.errors.push(`Auto-eval: ${evalError.message}`);
        } else {
          evalRunId = runId;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results[0]?.errors.push(`Auto-eval: ${msg}`);
      }
    }

    // Summary
    const summary = {
      scanned_at: new Date().toISOString(),
      providers_scanned: results.length,
      total_models: results.reduce((s, r) => s + r.models_found, 0),
      new_models: allNewModels.map((m) => `${m.provider}/${m.modelId}`),
      proposals_created: proposalsCreated,
      auto_eval_triggered: autoEval && allNewModels.length > 0,
      eval_run_id: evalRunId,
      provider_results: results,
    };

    // Audit log
    await supabase.rpc("write_audit_journal", {
      p_action_type: "info",
      p_area: "ai",
      p_details: {
        providers: requestedProviders,
        total_models: summary.total_models,
        new_models: summary.new_models,
        errors: results.flatMap((r) => r.errors),
      },
      p_entity_type: "ai_model_registry",
      p_summary: `Model discovery scan: ${summary.total_models} models, ${summary.new_models.length} new`,
      p_user_id: "00000000-0000-0000-0000-000000000001",
    });

    return jsonResponse(req, summary);
  } catch (error) {
    console.error("[discover-models] Error:", error);
    return jsonResponse(req, {
      error: "Discovery scan failed",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
