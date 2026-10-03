/**
 * Edge Function: aisha-push
 *
 * Dual-mode endpoint for Aisha → Developer communication:
 *
 * **GET `?stream=true`** — SSE stream for VS Code extension.
 *   Returns unread Aisha notifications as server-sent events,
 *   then keeps the connection alive with heartbeats.
 *   Extension handles reconnection automatically.
 *
 * **GET** (no stream) — One-shot poll for unread notifications (JSON).
 *
 * **POST** — Push a new notification from n8n / internal services.
 *   Auth: N8N_API_KEY header or service_role Bearer token.
 *
 * Notifications are stored in the existing `notifications` table
 * with `metadata->>'source' = 'aisha'`.
 *
 * @module
 */

import { serve, createClient } from "../_shared/deps.ts";
import { buildCorsHeaders, preflightResponse } from "../_shared/cors.ts";
import { getAllowedOriginsRaw } from "../_shared/runtimeConfig.ts";

const allowedOriginsRaw = getAllowedOriginsRaw();

/** How long to keep SSE connection alive (ms) — slightly under edge function timeout */
const SSE_LIFETIME_MS = 50_000;
/** Heartbeat interval (ms) */
const HEARTBEAT_MS = 15_000;
/** Poll interval for new notifications during SSE (ms) */
const POLL_INTERVAL_MS = 10_000;

interface AishaNotificationRow {
  id: string;
  title: string;
  message: string | null;
  type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  action_url: string | null;
}

serve(async (req: Request) => {
  // ── CORS preflight ──
  if (req.method === "OPTIONS") {
    return preflightResponse(req, allowedOriginsRaw, {
      allowMethods: "GET, POST, OPTIONS",
      allowHeaders: "authorization, x-client-info, apikey, content-type, x-n8n-api-key",
    });
  }

  const corsHeaders = buildCorsHeaders(req, allowedOriginsRaw, {
    allowMethods: "GET, POST, OPTIONS",
    allowHeaders: "authorization, x-client-info, apikey, content-type, x-n8n-api-key",
  });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // ── POST: Push a notification from n8n / internal ──
  if (req.method === "POST") {
    return handlePush(req, supabaseUrl, serviceRoleKey, corsHeaders);
  }

  // ── GET: SSE or one-shot poll ──
  if (req.method === "GET") {
    const url = new URL(req.url);
    const isStream = url.searchParams.get("stream") === "true";

    // Authenticate via Bearer token (user JWT preferred, service_role as fallback)
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");

    const supabaseService = createClient(supabaseUrl, serviceRoleKey);

    let userId: string;

    // Try user JWT first
    const { data: { user }, error: authError } = await supabaseService.auth.getUser(token);
    if (!authError && user) {
      userId = user.id;
    } else if (token === serviceRoleKey) {
      // Service role key fallback — system-level monitoring channel
      // Listen for broadcast notifications (no user-specific filtering)
      userId = "system";
    } else {
      return new Response(JSON.stringify({ error: "Unauthorized — login required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (isStream) {
      return handleSSEStream(userId, supabaseUrl, serviceRoleKey, corsHeaders);
    }

    return handlePoll(userId, supabaseUrl, serviceRoleKey, corsHeaders);
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

// ============================================================================
// POST Handler — Push notification from n8n / internal
// ============================================================================

async function handlePush(
  req: Request,
  supabaseUrl: string,
  serviceRoleKey: string,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  // Auth: N8N_API_KEY or service_role
  const n8nApiKey = Deno.env.get("N8N_API_KEY");
  const authHeader = req.headers.get("Authorization") ?? "";
  const n8nKeyHeader = req.headers.get("X-N8N-API-KEY") ?? "";

  const isN8nAuth = n8nApiKey && n8nKeyHeader === n8nApiKey;
  const isServiceRole = authHeader.includes(serviceRoleKey);

  if (!isN8nAuth && !isServiceRole) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: {
    user_id?: string;
    title?: string;
    message?: string;
    type?: string;
    action_url?: string;
    metadata?: Record<string, unknown>;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!body.user_id || !body.title) {
    return new Response(
      JSON.stringify({ error: "Missing required fields: user_id, title" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Validate UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(body.user_id)) {
    return new Response(
      JSON.stringify({ error: "Invalid UUID format for user_id" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Limit content length
  if ((body.title?.length ?? 0) > 500 || (body.message?.length ?? 0) > 5000) {
    return new Response(
      JSON.stringify({ error: "Content too long (title max 500, message max 5000)" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabaseService = createClient(supabaseUrl, serviceRoleKey);

  // Map push type to AishaPushEvent type for extension compatibility
  const eventType = body.type ?? "info";

  const { data, error } = await supabaseService
    .from("notifications")
    .insert({
      user_id: body.user_id,
      title: body.title,
      message: body.message ?? null,
      type: eventType,
      action_url: body.action_url ?? null,
      metadata: {
        source: "aisha",
        ...(body.metadata ?? {}),
      },
    })
    .select("id")
    .single();

  if (error) {
    console.error("[aisha-push] Insert error:", error.message);
    return new Response(
      JSON.stringify({ error: "Failed to create notification" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ ok: true, notification_id: data.id }),
    { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

// ============================================================================
// GET Handler — One-shot poll
// ============================================================================

async function handlePoll(
  userId: string,
  supabaseUrl: string,
  serviceRoleKey: string,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const supabaseService = createClient(supabaseUrl, serviceRoleKey);
  const notifications = await fetchUnreadNotifications(supabaseService, userId);

  // Mark as read
  if (notifications.length > 0) {
    const ids = notifications.map((n) => n.id);
    await supabaseService
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .in("id", ids);
  }

  return new Response(
    JSON.stringify({
      events: notifications.map(toSSEEvent),
      count: notifications.length,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

// ============================================================================
// GET Handler — SSE Stream
// ============================================================================

function handleSSEStream(
  userId: string,
  supabaseUrl: string,
  serviceRoleKey: string,
  corsHeaders: Record<string, string>,
): Response {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const supabaseService = createClient(supabaseUrl, serviceRoleKey);

      const send = (data: string) => {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      const sendHeartbeat = () => {
        controller.enqueue(encoder.encode(": heartbeat\n\n"));
      };

      // Track last check timestamp to only fetch new notifications
      let lastCheck = new Date(Date.now() - 60_000).toISOString(); // Start 1 min ago

      const pollAndSend = async () => {
        try {
          const notifications = await fetchUnreadNotifications(
            supabaseService,
            userId,
            lastCheck,
          );

          if (notifications.length > 0) {
            const ids = notifications.map((n) => n.id);

            for (const n of notifications) {
              send(JSON.stringify(toSSEEvent(n)));
            }

            // Mark as read
            await supabaseService
              .from("notifications")
              .update({ is_read: true, read_at: new Date().toISOString() })
              .in("id", ids);
          }

          lastCheck = new Date().toISOString();
        } catch {
          // Non-blocking — will retry on next poll
        }
      };

      // Initial fetch
      await pollAndSend();
      sendHeartbeat();

      // Periodic poll + heartbeat
      const startTime = Date.now();
      const interval = setInterval(async () => {
        if (Date.now() - startTime > SSE_LIFETIME_MS) {
          clearInterval(interval);
          controller.close();
          return;
        }

        await pollAndSend();
        sendHeartbeat();
      }, POLL_INTERVAL_MS);

      // Heartbeat between polls
      const heartbeatInterval = setInterval(() => {
        if (Date.now() - startTime > SSE_LIFETIME_MS) {
          clearInterval(heartbeatInterval);
          return;
        }
        sendHeartbeat();
      }, HEARTBEAT_MS);

      // Cleanup after SSE lifetime
      setTimeout(() => {
        clearInterval(interval);
        clearInterval(heartbeatInterval);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      }, SSE_LIFETIME_MS + 1000);
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ============================================================================
// Helpers
// ============================================================================

async function fetchUnreadNotifications(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  since?: string,
): Promise<AishaNotificationRow[]> {
  let query = supabase
    .from("notifications")
    .select("id, title, message, type, metadata, created_at, action_url")
    .eq("user_id", userId)
    .eq("is_read", false)
    .contains("metadata", { source: "aisha" })
    .order("created_at", { ascending: true })
    .limit(20);

  if (since) {
    query = query.gt("created_at", since);
  }

  const { data, error } = await query;

  if (error) {
    console.warn("[aisha-push] Query error:", error.message);
    return [];
  }

  return (data ?? []) as AishaNotificationRow[];
}

function toSSEEvent(n: AishaNotificationRow): {
  type: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  timestamp: string;
} {
  return {
    type: n.type ?? "info",
    title: n.title,
    body: n.message ?? "",
    metadata: n.metadata ?? {},
    timestamp: n.created_at,
  };
}
