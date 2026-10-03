import { serve, createClient } from "../_shared/deps.ts";
import { buildCorsHeaders, preflightResponse } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const webhookSecret = Deno.env.get("MATRIX_WEBHOOK_SECRET")!;

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[MATRIX-WEBHOOK] ${step}${detailsStr}`);
};

/**
 * Receives Matrix appservice events from Synapse and forwards to n8n.
 * Validates via shared secret (hs_token from appservice registration).
 *
 * Events: room messages, membership changes, bridge status updates.
 * Routes to n8n webhook for AISHA triage workflow.
 */
serve(async (req) => {
  if (req.method !== "PUT" && req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    logStep("Webhook received");

    // Validate appservice token (hs_token)
    const authParam = new URL(req.url).searchParams.get("access_token");
    const authHeader = req.headers.get("Authorization")?.replace("Bearer ", "");
    const token = authParam || authHeader;

    if (!token || token !== webhookSecret) {
      logStep("Unauthorized", { hasToken: !!token });
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const body = await req.json();
    const events = body.events || [];
    logStep("Processing events", { count: events.length });

    if (events.length === 0) {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const n8nWebhookUrl = Deno.env.get("N8N_MATRIX_WEBHOOK_URL");

    for (const event of events) {
      const eventType = event.type;
      const roomId = event.room_id;
      const sender = event.sender;

      logStep("Event", { type: eventType, room: roomId, sender });

      // Store bridge events in audit journal
      if (eventType === "m.room.message") {
        const content = event.content || {};
        const msgtype = content.msgtype;
        const body = content.body;

        // Log to audit_journal for compliance
        await supabase.from("audit_journal").insert({
          action: "matrix.message",
          entity_type: "matrix_room",
          entity_id: roomId,
          metadata: {
            sender,
            msgtype,
            event_id: event.event_id,
            // Do NOT log message body (PII/GDPR)
            has_body: !!body,
          },
        });
      }

      // Forward to n8n for AISHA triage
      if (n8nWebhookUrl && (n8nWebhookUrl.startsWith("https://") || n8nWebhookUrl.startsWith("http://localhost"))) {
        try {
          await fetch(n8nWebhookUrl, {
            method: "POST",
            signal: AbortSignal.timeout(10_000),
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              source: "matrix",
              event_type: eventType,
              room_id: roomId,
              sender,
              event_id: event.event_id,
              timestamp: event.origin_server_ts,
              content: event.content,
            }),
          });
        } catch (fetchErr) {
          logStep("n8n forward failed", { error: (fetchErr as Error).message });
        }
      }
    }

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    logStep("ERROR", { message: (err as Error).message });
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
