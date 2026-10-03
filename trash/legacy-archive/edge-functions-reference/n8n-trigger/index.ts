/**
 * Edge Function: n8n-trigger
 *
 * Programmatic trigger for n8n workflows from Evymo application.
 * Authenticated endpoint that forwards requests to n8n webhook endpoints.
 *
 * Use cases:
 *   - Admin UI triggering nightly audit manually
 *   - Application triggering compliance reroute
 *   - Scheduled tasks via Supabase pg_cron → Edge Function
 *
 * Requires: authenticated user with admin/staff role OR service_role key.
 *
 * POST body:
 *   {
 *     "workflow": "pr-compliance-gate" | "compliance-reroute" | "nightly-audit" | string,
 *     "payload": { ... }
 *   }
 *
 * Environment:
 *   - N8N_WEBHOOK_URL (e.g. https://aisha.id3a.cz)
 *   - N8N_API_KEY (optional, for n8n API auth)
 *
 * @module
 */

import { serve, createClient } from "../_shared/deps.ts";
import { corsGuard } from "../_shared/analyzeTrackingDocumentGuards.ts";
import {
  preflightResponse,
  silentCorsDenyResponse,
  buildCorsHeaders,
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

/** Map workflow name to n8n webhook path. */
const WORKFLOW_MAP: Record<string, string> = {
  // Worker workflows (event-driven)
  "pr-compliance-gate": "/webhook/pr-compliance-gate",
  "compliance-reroute": "/webhook/compliance-reroute",
  "nightly-audit": "/webhook/nightly-audit",
  "story-audit": "/webhook/story-audit",
  "billing-sync": "/webhook/billing-sync",
  "notification-dispatch": "/webhook/notification-dispatch",
  // AI Agent workflows (Personal Agents + MCP)
  "knowledge-agent": "/webhook/knowledge-agent",
  "compliance-agent": "/webhook/compliance-agent",
  "delivery-agent": "/webhook/delivery-agent",
  "dirigent-agent": "/webhook/dirigent-agent",
  // Pipeline execution (fallback when RabbitMQ unavailable)
  "pipeline-executor": "/webhook/pipeline-executor",
  // Multi-model routing
  "model-router": "/webhook/model-router",
};

serve(async (req: Request) => {
  // CORS preflight
  const corsResult = corsGuard(req, allowedOriginsRaw);
  if (corsResult === "preflight") return preflightResponse(req, allowedOriginsRaw);
  if (corsResult === "denied") return silentCorsDenyResponse();

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  // Auth: require authenticated user (admin/staff) or service_role
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Check if request uses service_role key directly
  const isServiceRole = authHeader.includes(serviceRoleKey);

  if (!isServiceRole) {
    // Verify user JWT + check admin/staff role
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return jsonResponse(req, { error: "Unauthorized" }, 401);
    }

    // Check admin/staff role
    const { data: roleCheck } = await supabase.rpc("is_admin_or_staff");
    if (!roleCheck) {
      return jsonResponse(req, { error: "Forbidden — admin/staff role required" }, 403);
    }
  }

  // Parse request
  let body: { workflow?: string; payload?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: "Invalid JSON body" }, 400);
  }

  const { workflow, payload = {} } = body;
  if (!workflow) {
    return jsonResponse(req, { error: "Missing 'workflow' field" }, 400);
  }

  // Resolve webhook path
  const webhookPath = WORKFLOW_MAP[workflow] ?? `/webhook/${workflow}`;
  const n8nBaseUrl = Deno.env.get("N8N_WEBHOOK_URL");
  if (!n8nBaseUrl) {
    console.error("[n8n-trigger] N8N_WEBHOOK_URL not configured");
    return jsonResponse(req, { error: "n8n not configured" }, 500);
  }

  const targetUrl = `${n8nBaseUrl.replace(/\/$/, "")}${webhookPath}`;

  // Forward to n8n
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Trigger-Source": "evymo-edge-function",
  };

  // Add n8n API key if available
  const n8nApiKey = Deno.env.get("N8N_API_KEY");
  if (n8nApiKey) {
    headers["X-N8N-API-KEY"] = n8nApiKey;
  }

  console.log(`[n8n-trigger] Triggering workflow=${workflow} → ${targetUrl}`);

  try {
    const n8nResp = await fetch(targetUrl, {
        signal: AbortSignal.timeout(15000),
      method: "POST",
      headers,
      body: JSON.stringify({
        ...payload,
        _trigger: {
          source: "evymo-n8n-trigger",
          timestamp: new Date().toISOString(),
          workflow,
        },
      }),
    });

    const n8nStatus = n8nResp.status;
    let n8nData: unknown;
    try {
      n8nData = await n8nResp.json();
    } catch (err) {
      // Non-JSON response (HTML 5xx page, plain text on webhook 200) — surface
      // raw body to caller for diagnostics rather than swallow the failure.
      console.warn("[n8n-trigger] n8n response not JSON, falling back to text:", err);
      n8nData = await n8nResp.text().catch(() => "(empty)");
    }

    return jsonResponse(
      req,
      {
        ok: n8nStatus < 400,
        workflow,
        webhook_path: webhookPath,
        n8n_status: n8nStatus,
        n8n_response: n8nData,
      },
      n8nStatus < 400 ? 200 : 502,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[n8n-trigger] Failed to reach n8n: ${message}`);
    return jsonResponse(req, { error: `n8n unreachable: ${message}` }, 502);
  }
});
