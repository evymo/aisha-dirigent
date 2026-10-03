/**
 * Edge Function: aisha-callback
 *
 * Webhook endpoint for Aisha/n8n to push messages into chat conversations
 * asynchronously. This enables Aisha Dirigent to proactively inject messages
 * without waiting for user interaction.
 *
 * Authentication: N8N_API_KEY header or SUPABASE_SERVICE_ROLE_KEY.
 *
 * POST body:
 *   {
 *     "conversation_id": "uuid",
 *     "content": "string",
 *     "user_id": "uuid",
 *     "action": "comment" | "escalate" | "notify",
 *     "metadata": { ... }
 *   }
 *
 * @module
 */

import { serve, createClient } from "../_shared/deps.ts";

const ALLOWED_ACTIONS = ["comment", "escalate", "notify"] as const;

serve(async (req: Request) => {
  // Only POST allowed
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-N8N-API-KEY",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Authenticate: n8n API key or service_role key
  const n8nApiKey = Deno.env.get("N8N_API_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const n8nKeyHeader = req.headers.get("X-N8N-API-KEY") ?? "";

  const isN8nAuth = n8nApiKey && n8nKeyHeader === n8nApiKey;
  const isServiceRole = authHeader.includes(serviceRoleKey);

  if (!isN8nAuth && !isServiceRole) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse and validate body
  let body: {
    conversation_id?: string;
    content?: string;
    user_id?: string;
    action?: string;
    metadata?: Record<string, unknown>;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { conversation_id, content, user_id, action = "comment", metadata = {} } = body;

  if (!conversation_id || !content || !user_id) {
    return new Response(
      JSON.stringify({ error: "Missing required fields: conversation_id, content, user_id" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(conversation_id) || !uuidRegex.test(user_id)) {
    return new Response(
      JSON.stringify({ error: "Invalid UUID format for conversation_id or user_id" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!ALLOWED_ACTIONS.includes(action as typeof ALLOWED_ACTIONS[number])) {
    return new Response(
      JSON.stringify({ error: `Invalid action. Allowed: ${ALLOWED_ACTIONS.join(", ")}` }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Limit content length
  if (content.length > 10000) {
    return new Response(
      JSON.stringify({ error: "Content too long (max 10000 chars)" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Use service_role to save the message
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseService = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { data, error } = await supabaseService.rpc("save_chat_message_audited", {
      p_content: content,
      p_conversation_id: conversation_id,
      p_model_used: "aisha-dirigent-async",
      p_response_time_ms: 0,
      p_role: "assistant",
      p_routed_to_agent_id: null,
      p_routing_category: "aisha_dirigent",
      p_tokens_input: 0,
      p_tokens_output: 0,
      p_user_id: user_id,
    });

    if (error) {
      console.error("[aisha-callback] save_chat_message_audited error:", error.message);
      return new Response(
        JSON.stringify({ error: "Failed to save message", detail: error.message }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const messageId = (data as { id: string })?.id ?? null;

    console.log(
      `[aisha-callback] Message saved: conversation=${conversation_id}, action=${action}, message_id=${messageId}`,
    );

    // Log to audit_journal
    await supabaseService.rpc("log_audit_event", {
      p_action: "AISHA_ASYNC_MESSAGE",
      p_metadata: {
        area: "ai",
        severity: action === "escalate" ? "warning" : "info",
        entity_type: "chat_message",
        entity_id: messageId,
        conversation_id,
        action,
        ...metadata,
      },
    }).catch((err: unknown) => {
      console.error("[aisha-callback] audit log failed:", err instanceof Error ? err.message : String(err));
    });

    return new Response(
      JSON.stringify({
        ok: true,
        message_id: messageId,
        conversation_id,
        action,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[aisha-callback] Error: ${message}`);
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
