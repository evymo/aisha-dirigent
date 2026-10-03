import "https://deno.land/x/xhr@0.3.0/mod.ts";
import { serve, createClient } from "../_shared/deps.ts";

import { preflightResponse, silentCorsDenyResponse } from "../_shared/cors.ts";
import { jsonResponse as jsonResponseBase } from "../_shared/http.ts";
import { corsGuard } from "../_shared/analyzeTrackingDocumentGuards.ts";
import { getAllowedOriginsRaw } from "../_shared/runtimeConfig.ts";

const allowedOriginsRaw = getAllowedOriginsRaw();

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200): Response {
  return jsonResponseBase(req, allowedOriginsRaw, body, status);
}

type AdminOpenAiKeyAction = "status" | "validate" | "set";

interface AdminOpenAiKeyRequestBody {
  action?: AdminOpenAiKeyAction;
  apiKey?: string;
}

function isValidOpenAiKeyFormat(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("sk-") && trimmed.length >= 20;
}

async function validateKeyWithOpenAi(apiKey: string): Promise<{ ok: true } | { ok: false; status: number }> {
  const response = await fetch("https://api.openai.com/v1/models", {
      signal: AbortSignal.timeout(60000),
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (response.ok) return { ok: true };
  return { ok: false, status: response.status };
}

serve(async (req) => {
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

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get auth header and verify user
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

    // Check if user is admin
    const { data: isAdmin, error: roleError } = await supabase.rpc("has_role", {
      p_role: "admin",
      p_user_id: user.id,
    });
    
    if (roleError || !isAdmin) {
      return jsonResponse(req, { error: "Forbidden - Admin access required" }, 403);
    }

    let body: AdminOpenAiKeyRequestBody;
    try {
      body = await req.json() as AdminOpenAiKeyRequestBody;
    } catch {
      return jsonResponse(req, { error: "Invalid JSON body" }, 400);
    }

    const action: AdminOpenAiKeyAction = body.action ?? "set";

    if (action === "status") {
      const { data, error } = await supabase.rpc("edge_app_secrets", {
        p_action: "get_many",
        p_payload: {
          keys: ["openai_api_key"],
        },
      });

      if (error) {
        return jsonResponse(req, { error: "Failed to load status" }, 500);
      }

      const rows = (data as { rows?: Array<{ key?: unknown; updated_at?: unknown; updated_by?: unknown }> } | null)?.rows ?? [];
      const row = rows.find((item) => item.key === "openai_api_key");

      return jsonResponse(req, {
        configured: Boolean(row?.key),
        updated_at: row?.updated_at ?? null,
        updated_by: row?.updated_by ?? null,
      });
    }

    const apiKey = body.apiKey;

    if (typeof apiKey !== "string" || !isValidOpenAiKeyFormat(apiKey)) {
      return jsonResponse(req, { error: "Invalid API key format" }, 400);
    }

    const validation = await validateKeyWithOpenAi(apiKey);

    if (!validation.ok) {
      // Do not leak OpenAI error bodies; status is sufficient.
      return jsonResponse(req, { error: "Invalid OpenAI API key", status: validation.status }, 400);
    }

    if (action === "validate") {
      return jsonResponse(req, { valid: true });
    }

    // action === "set"
    const { error: upsertError } = await supabase.rpc("edge_app_secrets", {
      p_action: "upsert_admin",
      p_payload: {
        actor_user_id: user.id,
        key: "openai_api_key",
        updated_by: user.id,
        value: apiKey.trim(),
      },
    });

    if (upsertError) {
      console.error("[update-openai-key] Upsert error:", upsertError);
      return jsonResponse(req, { error: "Failed to store API key", details: upsertError.message }, 500);
    }

    // Audit log - non-blocking (don't fail the operation if audit fails)
    try {
      await supabase.rpc("write_audit_journal", {
        p_action_type: "update",
        p_area: "admin",
        p_details: {
          key: "openai_api_key",
        },
        p_entity_id: "openai_api_key",
        p_entity_type: "app_secrets",
        p_severity: "warning",
        p_summary: "Updated OpenAI API key",
        p_tags: ["admin", "config"],
        p_user_id: user.id,
      });
    } catch (auditError) {
      console.warn("[update-openai-key] Audit log failed (non-blocking):", auditError);
    }

    return jsonResponse(req, { success: true });

  } catch (error) {
    console.error("[update-openai-key] Error:", error);
    return jsonResponse(req, { error: "An unexpected error occurred" }, 500);
  }
});
