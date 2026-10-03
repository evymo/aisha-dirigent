/**
 * ai-proactive — Proactive AI trigger edge function.
 *
 * This edge function is the HTTP entry point for:
 * 1. **Event-driven triggers**: Called when a source event occurs
 *    (e.g. new lab result, high pain check-in). Evaluates active
 *    trigger definitions and dispatches AI analysis.
 * 2. **Stats**: Returns proactive system statistics.
 *
 * Endpoints:
 *   POST /ai-proactive
 *     Action "evaluate": Evaluate triggers for a source event
 *     Action "stats":    Get proactive system statistics
 *
 * Authentication:
 *   - User token (for event-driven triggers from client)
 *   - Service role key (for system-initiated evaluations)
 *
 * @module
 */

import { serve, createClient } from "../_shared/deps.ts";
import { createTracer } from "../_shared/tracer.ts";
import { createProactiveEngine } from "../_shared/proactiveEngine.ts";
import type { SourceEventInput } from "../_shared/proactiveEngine.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvaluateBody {
  action: "evaluate";
  source_table: string;
  source_event?: "INSERT" | "UPDATE" | "DELETE" | "CRON";
  record_data: Record<string, unknown>;
  user_id: string;
  source_record_id?: string;
}

interface StatsBody {
  action: "stats";
}

type RequestBody = EvaluateBody | StatsBody;

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

interface AuthContext {
  userId: string | null;
  isServiceRole: boolean;
  token: string;
}

async function authenticate(req: Request): Promise<AuthContext | Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");

  // Check if service role
  if (token === serviceKey) {
    return { userId: null, isServiceRole: true, token };
  }

  // Authenticate as user
  const anonClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const {
    data: { user },
    error: authError,
  } = await anonClient.auth.getUser();

  if (authError || !user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  return { userId: user.id, isServiceRole: false, token };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Authenticate
  const authResult = await authenticate(req);
  if (authResult instanceof Response) {
    return authResult;
  }
  const { userId, isServiceRole, token } = authResult;

  // Parse body
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!body.action) {
    return jsonResponse({ error: "action is required" }, 400);
  }

  // Create service client
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const serviceClient = createClient(supabaseUrl, serviceKey, {
    global: {
      headers: isServiceRole
        ? {}
        : { Authorization: `Bearer ${token}` },
    },
  });

  try {
    switch (body.action) {
      // -------------------------------------------------------------------
      // Evaluate triggers for a source event
      // -------------------------------------------------------------------
      case "evaluate": {
        const evalBody = body as EvaluateBody;

        if (!evalBody.source_table || !evalBody.record_data || !evalBody.user_id) {
          return jsonResponse(
            { error: "source_table, record_data, and user_id are required" },
            400,
          );
        }

        // Only service_role or the user themselves can trigger evaluation
        if (!isServiceRole && userId !== evalBody.user_id) {
          return jsonResponse({ error: "Forbidden" }, 403);
        }

        const tracer = await createTracer(serviceClient, {
          kind: "proactive",
          actorUserId: evalBody.user_id,
        });

        const engine = createProactiveEngine(serviceClient, tracer);

        const input: SourceEventInput = {
          sourceTable: evalBody.source_table,
          sourceEvent: evalBody.source_event ?? "INSERT",
          recordData: evalBody.record_data,
          userId: evalBody.user_id,
          sourceRecordId: evalBody.source_record_id,
        };

        const results = await engine.evaluateSource(input);

        await tracer.finish("succeeded", {
          action: "evaluate",
          source_table: evalBody.source_table,
          triggers_evaluated: results.length,
          triggers_matched: results.filter((r) => r.matched).length,
        });

        return jsonResponse({
          results,
          summary: {
            total: results.length,
            matched: results.filter((r) => r.matched).length,
            skipped: results.filter((r) => r.skippedReason).length,
            errors: results.filter((r) => r.error).length,
          },
        });
      }

      // -------------------------------------------------------------------
      // Get proactive system stats
      // -------------------------------------------------------------------
      case "stats": {
        // Require authentication (user or service_role)
        if (!isServiceRole && !userId) {
          return jsonResponse({ error: "Unauthorized" }, 401);
        }

        const tracer = await createTracer(serviceClient, {
          kind: "proactive",
          actorUserId: userId ?? undefined,
        });

        const engine = createProactiveEngine(serviceClient, tracer);
        const stats = await engine.getStats();

        await tracer.finish("succeeded", { action: "stats" });

        return jsonResponse(stats);
      }

      default:
        return jsonResponse(
          { error: `Unknown action: ${(body as Record<string, unknown>).action}` },
          400,
        );
    }
  } catch (error) {
    console.error("[ai-proactive] Error:", error);
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      500,
    );
  }
});
