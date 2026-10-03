/**
 * Edge Function: plugin-registry
 *
 * Public-facing endpoint for listing available plugins.
 * Used by frontend to discover and bootstrap plugins at app init.
 *
 * GET /functions/v1/plugin-registry?kind=full_stack&tenant_id=xxx
 *
 * Returns a list of available plugins (status: canary | ga) with
 * resolved config (merged global + tenant override).
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
import { safeError } from "../_shared/safeLogger.ts";

const allowedOriginsRaw = getAllowedOriginsRaw();

function jsonResponse(
  req: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return jsonResponseBase(req, allowedOriginsRaw, body, status);
}

serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const corsFailure = corsGuard({ origin, allowedOriginsRaw });
  if (corsFailure) return silentCorsDenyResponse();

  if (req.method === "OPTIONS") {
    return preflightResponse(req, allowedOriginsRaw, {
      allowMethods: "GET, OPTIONS",
    });
  }

  if (req.method !== "GET") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  try {
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind") ?? null;
    const tenantId = url.searchParams.get("tenant_id") ?? null;

    // Auth: use user token or anon key
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    if (!supabaseUrl || !supabaseAnonKey) {
      return jsonResponse(req, { error: "Server not configured" }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: authHeader
        ? { headers: { Authorization: authHeader } }
        : undefined,
    });

    const { data, error } = await supabase.rpc("get_available_plugins", {
      p_kind: kind,
      p_tenant_id: tenantId,
    });

    if (error) {
      safeError("plugin-registry.rpc-failed", error);
      return jsonResponse(req, { error: "Failed to fetch plugins" }, 500);
    }

    return jsonResponse(req, {
      plugins: data ?? [],
      count: Array.isArray(data) ? data.length : 0,
    });
  } catch (err) {
    safeError("plugin-registry.handler.failed", err);
    return jsonResponse(req, { error: "Registry error" }, 500);
  }
});
