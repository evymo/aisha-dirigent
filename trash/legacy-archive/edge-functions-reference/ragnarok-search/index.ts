/**
 * Edge Function: ragnarok-search
 *
 * Proxy to Ragnarok RAG engine for hybrid document retrieval.
 * Accepts authenticated requests and forwards them to Ragnarok's
 * `/projects/{project_id}/nlp/rag/` endpoint.
 *
 * Supports both standard JSON and streaming NDJSON responses.
 *
 * POST body:
 *   {
 *     "query": string,           // User query
 *     "project_id"?: string,     // Ragnarok project ID (default: "evymo")
 *     "kb_ids"?: string[],       // Knowledge base IDs to search
 *     "lang"?: string,           // Language (default: "cs-CZ")
 *     "context"?: Array<{ role: string, content: string }>,
 *     "stream"?: boolean,        // Use streaming response
 *     "return_highlights"?: boolean,
 *     "return_matched_chunks"?: boolean,
 *     "settings"?: object        // AISettings override
 *   }
 *
 * Environment:
 *   - RAGNAROK_URL (e.g. http://ragnarok:9696)
 *   - RAGNAROK_API_KEY
 *
 * @module
 */

import { serve, createClient } from "../_shared/deps.ts";
import { corsGuard } from "../_shared/analyzeTrackingDocumentGuards.ts";
import {
  preflightResponse,
  silentCorsDenyResponse,
} from "../_shared/cors.ts";
import { jsonResponse as jsonResponseBase } from "../_shared/http.ts";
import { getAllowedOriginsRaw } from "../_shared/runtimeConfig.ts";

const allowedOriginsRaw = getAllowedOriginsRaw();

function jsonResponse(
  req: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return jsonResponseBase(req, allowedOriginsRaw, body, status);
}

/** Default Ragnarok project ID for Evymo knowledge base. */
const DEFAULT_PROJECT_ID = "evymo";

/** Default language for RAG queries. */
const DEFAULT_LANG = "cs-CZ";

/**
 * Validate and sanitize the incoming request body.
 */
function validatePayload(body: unknown): {
  ok: true;
  payload: RagnarokSearchPayload;
} | {
  ok: false;
  error: string;
} {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Request body is required" };
  }

  const b = body as Record<string, unknown>;

  if (typeof b.query !== "string" || b.query.trim().length === 0) {
    return { ok: false, error: "query is required and must be a non-empty string" };
  }

  if (b.query.length > 10_000) {
    return { ok: false, error: "query exceeds maximum length (10000 chars)" };
  }

  if (b.project_id !== undefined && typeof b.project_id !== "string") {
    return { ok: false, error: "project_id must be a string" };
  }

  if (b.kb_ids !== undefined) {
    if (!Array.isArray(b.kb_ids) || !b.kb_ids.every((id: unknown) => typeof id === "string")) {
      return { ok: false, error: "kb_ids must be an array of strings" };
    }
  }

  return {
    ok: true,
    payload: {
      query: b.query.trim(),
      project_id: (typeof b.project_id === "string" ? b.project_id : DEFAULT_PROJECT_ID),
      kb_ids: Array.isArray(b.kb_ids) ? b.kb_ids as string[] : undefined,
      lang: typeof b.lang === "string" ? b.lang : DEFAULT_LANG,
      context: Array.isArray(b.context) ? b.context as ConversationTurn[] : undefined,
      stream: b.stream === true,
      return_highlights: b.return_highlights === true,
      return_matched_chunks: b.return_matched_chunks === true,
      settings: (b.settings && typeof b.settings === "object") ? b.settings as Record<string, unknown> : undefined,
    },
  };
}

interface ConversationTurn {
  role: string;
  content: string;
}

interface RagnarokSearchPayload {
  query: string;
  project_id: string;
  kb_ids?: string[];
  lang: string;
  context?: ConversationTurn[];
  stream: boolean;
  return_highlights: boolean;
  return_matched_chunks: boolean;
  settings?: Record<string, unknown>;
}

/**
 * Build the Ragnarok API request body from validated payload.
 */
function buildRagnarokBody(payload: RagnarokSearchPayload): Record<string, unknown> {
  const body: Record<string, unknown> = {
    query: payload.query,
    lang: payload.lang,
    return_highlights: payload.return_highlights,
    return_matched_chunks: payload.return_matched_chunks,
  };

  if (payload.kb_ids && payload.kb_ids.length > 0) {
    body.kb_ids = payload.kb_ids;
  }

  if (payload.context && payload.context.length > 0) {
    body.context = payload.context;
  }

  if (payload.settings) {
    body.settings = payload.settings;
  }

  return body;
}

serve(async (req: Request) => {
  // --- CORS ---
  const origin = req.headers.get("Origin");
  const corsFailure = corsGuard({ origin, allowedOriginsRaw });
  if (corsFailure) return silentCorsDenyResponse();

  if (req.method === "OPTIONS") {
    return preflightResponse(req, allowedOriginsRaw, { allowMethods: "POST, OPTIONS" });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  // --- Auth: require authenticated user or service_role ---
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse(req, { error: "Server not configured" }, 500);
  }

  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return jsonResponse(req, { error: "Not authenticated" }, 401);
  }

  // Allow service_role key for internal calls (MCP, n8n)
  const isServiceRole = token === serviceRoleKey;

  if (!isServiceRole) {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return jsonResponse(req, { error: "Not authenticated" }, 401);
    }
  }

  // --- Ragnarok config ---
  // Local dev: Supabase CLI edge runtime doesn't inject custom env vars into Docker container.
  // Fallback to local defaults when RAGNAROK_URL is not set.
  const ragnarokUrl = Deno.env.get("RAGNAROK_URL") ?? "http://host.docker.internal:9696";
  const ragnarokApiKey = Deno.env.get("RAGNAROK_API_KEY") ?? "evymo-ragnarok-local";

  // --- Parse and validate body ---
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: "Invalid JSON body" }, 400);
  }

  const validation = validatePayload(body);
  if (!validation.ok) {
    return jsonResponse(req, { error: validation.error }, 400);
  }

  const { payload } = validation;
  const ragnarokBody = buildRagnarokBody(payload);

  // --- Choose endpoint (streaming vs standard) ---
  const endpoint = payload.stream
    ? `${ragnarokUrl}/projects/${encodeURIComponent(payload.project_id)}/nlp/rag/stream`
    : `${ragnarokUrl}/projects/${encodeURIComponent(payload.project_id)}/nlp/rag/`;

  // --- Call Ragnarok ---
  try {
    const ragnarokResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": ragnarokApiKey,
      },
      body: JSON.stringify(ragnarokBody),
      signal: AbortSignal.timeout(60_000),
    });

    if (!ragnarokResponse.ok) {
      const errorText = await ragnarokResponse.text().catch(() => "(empty)");
      console.error(`Ragnarok API error ${ragnarokResponse.status}: ${errorText.slice(0, 500)}`);
      return jsonResponse(
        req,
        { error: "RAG search failed", status: ragnarokResponse.status },
        502,
      );
    }

    // --- Streaming response: pipe through ---
    if (payload.stream && ragnarokResponse.body) {
      const { buildCorsHeaders } = await import("../_shared/cors.ts");
      const corsHeaders = buildCorsHeaders(req, allowedOriginsRaw);

      return new Response(ragnarokResponse.body, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/x-ndjson",
          "Transfer-Encoding": "chunked",
        },
      });
    }

    // --- Standard JSON response ---
    const ragnarokData = await ragnarokResponse.json();

    return jsonResponse(req, {
      ok: true,
      data: ragnarokData,
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return jsonResponse(req, { error: "Ragnarok request timed out" }, 504);
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Ragnarok fetch error: ${msg}`);
    return jsonResponse(req, { error: "RAG service unavailable" }, 502);
  }
});
