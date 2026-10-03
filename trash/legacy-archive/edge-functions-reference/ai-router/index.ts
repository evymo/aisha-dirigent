/**
 * Edge Function: ai-router
 *
 * HTTP POST wrapper over the `route_task()` RPC.
 * Takes a task envelope, selects agents + models + context by task kind
 * and risk profile, creates an ai_run, and returns a route_plan.
 *
 * Used by n8n workflows and external MCP consumers via HTTP.
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
import { publishPipelineTask } from "../_shared/mqClient.ts";

const allowedOriginsRaw = getAllowedOriginsRaw();

function jsonResponse(
  req: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return jsonResponseBase(req, allowedOriginsRaw, body, status);
}

// ============================================
// TYPES
// ============================================

interface RouteTaskRequest {
  task_kind: string;
  risk_profile?: string;
  domain?: string[];
  tech?: string[];
  story_id?: string;
  constraints?: Record<string, unknown>;
}

// ============================================
// MAIN HANDLER
// ============================================

serve(async (req) => {
  // CORS origin validation
  const originFailure = corsGuard({
    origin: req.headers.get("Origin"),
    allowedOriginsRaw,
  });
  if (originFailure) {
    return silentCorsDenyResponse();
  }

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return preflightResponse(req, allowedOriginsRaw);
  }

  const corsHeaders = buildCorsHeaders(req, allowedOriginsRaw);

  try {
    // ----------------------------------------
    // 1. AUTHENTICATE
    // ----------------------------------------
    const authHeader = req.headers.get("Authorization");
    const mcpToken = req.headers.get("X-MCP-Token");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseAnonKey) {
      console.error("[ai-router] Missing SUPABASE_ANON_KEY");
      return jsonResponse(req, { error: "Configuration error" }, 500);
    }

    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);

    // Support dual auth: JWT Bearer OR MCP Token
    if (mcpToken) {
      // MCP token auth — validate via RPC
      const { data: tokenResult, error: tokenError } = await supabaseService.rpc(
        "validate_mcp_token",
        { p_token_hash: mcpToken, p_tool_name: "route_task" },
      );

      if (tokenError || !tokenResult?.valid) {
        console.error("[ai-router] MCP token validation failed:", tokenError?.message);
        return jsonResponse(req, { error: "Invalid MCP token" }, 401);
      }
    } else if (authHeader) {
      // Standard JWT auth
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authError } =
        await supabaseService.auth.getUser(token);

      if (authError || !user) {
        console.error("[ai-router] Auth error:", authError?.message);
        return jsonResponse(req, { error: "Unauthorized" }, 401);
      }
    } else {
      return jsonResponse(req, { error: "Authorization required" }, 401);
    }

    // ----------------------------------------
    // 2. PARSE REQUEST
    // ----------------------------------------
    if (req.method !== "POST") {
      return jsonResponse(req, { error: "Method not allowed" }, 405);
    }

    const body = (await req.json()) as RouteTaskRequest;

    if (!body.task_kind) {
      return jsonResponse(req, { error: "task_kind is required" }, 400);
    }

    const validKinds = [
      "chat",
      "project_delivery",
      "compliance_check",
      "guild_review",
      "pr_gate",
      "incident",
      "doc_update",
    ];
    if (!validKinds.includes(body.task_kind)) {
      return jsonResponse(
        req,
        { error: `Invalid task_kind. Expected one of: ${validKinds.join(", ")}` },
        400,
      );
    }

    // ----------------------------------------
    // 3. ROUTE TASK via RPC
    // ----------------------------------------
    const { data: routePlan, error: rpcError } = await supabaseService.rpc(
      "route_task",
      {
        p_constraints: body.constraints ?? {},
      
        p_domain: body.domain ?? [],
        p_risk_profile: body.risk_profile ?? "low",
        p_story_id: body.story_id ?? null,
        p_task_kind: body.task_kind,
        p_tech: body.tech ?? [],},
    );

    if (rpcError) {
      console.error("[ai-router] RPC error:", rpcError.message);
      return jsonResponse(req, { error: "Routing failed" }, 500);
    }

    // ----------------------------------------
    // 4. PUBLISH TO PIPELINE QUEUE (multi-agent only)
    // ----------------------------------------
    const agents: string[] = routePlan?.agents ?? [];
    const SINGLE_AGENT_KINDS = ["chat"];

    if (agents.length > 1 && !SINGLE_AGENT_KINDS.includes(body.task_kind)) {
      const published = await publishPipelineTask({
        agents,
        context_profile: routePlan?.context_profile ?? "repo_plus_rules",
        created_at: new Date().toISOString(),
        risk_profile: body.risk_profile ?? "low",
        run_id: routePlan?.run_id ?? "",
        stop_conditions: routePlan?.stop_conditions ?? {},
        story_id: body.story_id ?? null,
        task_kind: body.task_kind,
      });

      if (!published) {
        console.error("[ai-router] RabbitMQ publish failed — pipeline will not auto-execute");
      }
    }

    // ----------------------------------------
    // 5. RETURN ROUTE PLAN
    // ----------------------------------------
    return jsonResponse(req, {
      success: true,
      route_plan: routePlan,
      pipeline_queued: agents.length > 1 && !SINGLE_AGENT_KINDS.includes(body.task_kind),
    });
  } catch (err) {
    console.error("[ai-router] Unexpected error:", (err as Error).message);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
