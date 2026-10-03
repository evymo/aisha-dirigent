/**
 * Edge Function: public-chat
 *
 * Stateless entry point for public-facing chatbot.
 * Validates request, resolves channel config from DB,
 * forwards to n8n WF_PUBLIC_CHATBOT webhook.
 *
 * Authentication: None required (public endpoint).
 * Rate limiting: per visitor_id (via channel guardrails config).
 *
 * POST body:
 *   {
 *     "message": "string",
 *     "channel": "string (slug)",
 *     "visitor_id": "string",
 *     "visitor_metadata": { "name"?: string, "email"?: string },
 *     "source": "web_widget" | "api" | "whatsapp" | "telegram"
 *   }
 *
 * @module
 */

import { serve, createClient } from "../_shared/deps.ts";
import { preflightResponse, buildCorsHeaders } from "../_shared/cors.ts";
import { getAllowedOriginsRaw } from "../_shared/runtimeConfig.ts";

const allowedOriginsRaw = getAllowedOriginsRaw();

// In-memory rate limiter (per Deno isolate — not shared across instances)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(
  visitorId: string,
  perMinute: number,
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(visitorId);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(visitorId, { count: 1, resetAt: now + 60_000 });
    return { allowed: true, remaining: perMinute - 1 };
  }

  if (entry.count >= perMinute) {
    return { allowed: false, remaining: 0 };
  }

  entry.count++;
  return { allowed: true, remaining: perMinute - entry.count };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return preflightResponse(req, allowedOriginsRaw, {
      allowHeaders: "content-type, authorization, x-visitor-id",
    });
  }

  const corsHeaders = buildCorsHeaders(req, allowedOriginsRaw, {
    allowHeaders: "content-type, authorization, x-visitor-id",
  });

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: corsHeaders },
    );
  }

  // Parse body
  let body: {
    message?: string;
    channel?: string;
    visitor_id?: string;
    visitor_metadata?: Record<string, unknown>;
    source?: string;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: corsHeaders },
    );
  }

  const message = body.message?.trim();
  if (!message) {
    return new Response(
      JSON.stringify({ error: "Missing 'message' field" }),
      { status: 400, headers: corsHeaders },
    );
  }

  // Limit message length to prevent abuse
  if (message.length > 4000) {
    return new Response(
      JSON.stringify({ error: "Message too long (max 4000 chars)" }),
      { status: 400, headers: corsHeaders },
    );
  }

  const channelSlug = body.channel || "default";
  const visitorId =
    body.visitor_id ||
    req.headers.get("X-Visitor-Id") ||
    `anon-${crypto.randomUUID().slice(0, 8)}`;

  // Load channel config to check guardrails
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: channelConfig, error: configError } = await db.rpc(
    "get_active_channel_config",
    { p_channel_slug: channelSlug },
  );

  if (configError || channelConfig?.error) {
    return new Response(
      JSON.stringify({
        error: "Channel not found or inactive",
        channel: channelSlug,
      }),
      { status: 404, headers: corsHeaders },
    );
  }

  // Apply rate limiting from channel guardrails
  const guardrails = channelConfig.guardrails || {};
  const ratePerMinute = guardrails.rate_limit_per_minute || 10;

  const { allowed, remaining } = checkRateLimit(visitorId, ratePerMinute);
  if (!allowed) {
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded. Please wait." }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          "Retry-After": "60",
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  // Check message length against channel guardrails
  const maxLen = guardrails.max_message_length || 2000;
  if (message.length > maxLen) {
    return new Response(
      JSON.stringify({
        error: `Message too long for this channel (max ${maxLen} chars)`,
      }),
      { status: 400, headers: corsHeaders },
    );
  }

  // Forward to n8n WF_PUBLIC_CHATBOT webhook
  const n8nBaseUrl = Deno.env.get("N8N_BASE_URL") || "https://aisha.id3a.cz";
  const webhookUrl = channelConfig.webhook_url ||
    `${n8nBaseUrl}/webhook/public-chat`;

  try {
    const n8nResponse = await fetch(webhookUrl, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        channel: channelSlug,
        visitor_id: visitorId,
        visitor_metadata: body.visitor_metadata || {},
        source: body.source || "api",
      }),
    });

    if (!n8nResponse.ok) {
      const errorText = await n8nResponse.text().catch(() => "Unknown error");
      console.error(
        `n8n webhook error: ${n8nResponse.status} — ${errorText}`,
      );
      return new Response(
        JSON.stringify({
          error: "Chat service temporarily unavailable",
          status: n8nResponse.status,
        }),
        { status: 502, headers: corsHeaders },
      );
    }

    const result = await n8nResponse.json();

    return new Response(
      JSON.stringify({
        success: true,
        session_id: result.session_id,
        response: result.response,
        channel: channelSlug,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "X-RateLimit-Remaining": String(remaining),
        },
      },
    );
  } catch (err) {
    console.error("Failed to reach n8n:", err);
    return new Response(
      JSON.stringify({ error: "Chat service temporarily unavailable" }),
      { status: 502, headers: corsHeaders },
    );
  }
});
