/**
 * Edge function: list-openai-models
 *
 * Returns the list of OpenAI chat-capable models available for the stored API key.
 * Only models whose id starts with an allowed prefix (gpt-, o1-, o3-, o4-) are returned.
 * Requires admin role.
 *
 * @module
 */
import { serve, createClient } from "../_shared/deps.ts";
import { preflightResponse, silentCorsDenyResponse } from "../_shared/cors.ts";
import { jsonResponse as jsonResponseBase } from "../_shared/http.ts";
import { corsGuard } from "../_shared/analyzeTrackingDocumentGuards.ts";
import { getAllowedOriginsRaw } from "../_shared/runtimeConfig.ts";
import { getOpenAiApiKey } from "../_shared/openaiKey.ts";

const allowedOriginsRaw = getAllowedOriginsRaw();

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200): Response {
  return jsonResponseBase(req, allowedOriginsRaw, body, status);
}

/** Prefixes of models relevant for chat / reasoning. Configurable via env. */
const CHAT_MODEL_PREFIXES = (Deno.env.get("CHAT_MODEL_PREFIXES") ?? "gpt-,o1-,o3-,o4-").split(",").map((s) => s.trim());

/** Model id substrings that indicate non-chat variants (embeddings, audio, etc.). */
const EXCLUDED_SUBSTRINGS = [
  "embedding",
  "whisper",
  "dall-e",
  "tts",
  "moderation",
  "davinci",
  "babbage",
  "curie",
  "ada",
  "realtime",
  "transcription",
  "search",
  "audio",
];

interface OpenAiModel {
  id: string;
  created: number;
  owned_by: string;
}

interface OpenAiModelsResponse {
  data: OpenAiModel[];
}

function isChatModel(id: string): boolean {
  const lower = id.toLowerCase();
  const hasAllowedPrefix = CHAT_MODEL_PREFIXES.some((p) => lower.startsWith(p));
  if (!hasAllowedPrefix) return false;

  return !EXCLUDED_SUBSTRINGS.some((sub) => lower.includes(sub));
}

serve(async (req) => {
  // --- CORS ---
  const originFailure = corsGuard({
    origin: req.headers.get("Origin"),
    allowedOriginsRaw,
  });

  if (originFailure) {
    return silentCorsDenyResponse();
  }

  if (req.method === "OPTIONS") {
    return preflightResponse(req, allowedOriginsRaw);
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // --- Auth ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse(req, { error: "Unauthorized" }, 401);
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return jsonResponse(req, { error: "Unauthorized" }, 401);
    }

    // --- Admin check ---
    const { data: isAdmin, error: roleError } = await supabase.rpc("has_role", {
      p_role: "admin",
      p_user_id: user.id,
    });

    if (roleError || !isAdmin) {
      return jsonResponse(req, { error: "Forbidden - Admin access required" }, 403);
    }

    // --- Get stored OpenAI key ---
    const apiKey = await getOpenAiApiKey(supabase);

    if (!apiKey) {
      return jsonResponse(req, { error: "OpenAI API key not configured" }, 424);
    }

    // --- Fetch models from OpenAI ---
    const response = await fetch("https://api.openai.com/v1/models", {
        signal: AbortSignal.timeout(60000),
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      return jsonResponse(
        req,
        { error: "Failed to fetch models from OpenAI", status: response.status },
        502,
      );
    }

    const result = (await response.json()) as OpenAiModelsResponse;

    // --- Filter to chat/reasoning models ---
    const chatModels = (result.data ?? [])
      .filter((m) => isChatModel(m.id))
      .map((m) => ({
        id: m.id,
        created: m.created,
        owned_by: m.owned_by,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

    return jsonResponse(req, { models: chatModels });
  } catch (error) {
    console.error("[list-openai-models] Error:", error);
    return jsonResponse(req, { error: "An unexpected error occurred" }, 500);
  }
});
