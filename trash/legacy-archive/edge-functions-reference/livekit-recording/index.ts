import { serve, createClient } from "../_shared/deps.ts";
import { buildCorsHeaders, preflightResponse } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const livekitApiKey = Deno.env.get("LIVEKIT_API_KEY")!;
const livekitApiSecret = Deno.env.get("LIVEKIT_API_SECRET")!;
const livekitHost = Deno.env.get("LIVEKIT_HOST") ?? "https://livekit.id3a.cz";

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[LIVEKIT-RECORDING] ${step}${detailsStr}`);
};

/**
 * Create Base64URL-encoded HMAC-SHA256 JWT for LiveKit Egress API.
 */
async function createEgressApiToken(): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: livekitApiKey,
    sub: livekitApiKey,
    iat: now,
    exp: now + 600,
    video: { roomRecord: true },
  };

  const enc = new TextEncoder();

  const toBase64Url = (data: Uint8Array) =>
    btoa(String.fromCharCode(...data))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const headerB64 = toBase64Url(enc.encode(JSON.stringify(header)));
  const payloadB64 = toBase64Url(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(livekitApiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(signingInput))
  );

  return `${signingInput}.${toBase64Url(signature)}`;
}

/**
 * LiveKit Recording via Egress API.
 *
 * Body:
 *   { action: "start", room_name: string, session_id: string }
 *   { action: "stop", egress_id: string, session_id: string }
 */
serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req, "*");

  if (req.method === "OPTIONS") {
    return preflightResponse(req, "*");
  }

  try {
    logStep("Function started");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verify caller identity
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { action, room_name, egress_id, session_id } = body;

    if (!session_id) {
      return new Response(
        JSON.stringify({ error: "session_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify recording consent exists for session
    const { data: session, error: sessionError } = await supabase
      .from("consultation_sessions")
      .select("id, recording_consent, caller_id, callee_id")
      .eq("id", session_id)
      .single();

    if (sessionError || !session) {
      logStep("Session not found", { session_id });
      return new Response(
        JSON.stringify({ error: "Session not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Only caller or callee can manage recording
    if (session.caller_id !== user.id && session.callee_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "Not a participant of this session" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!session.recording_consent) {
      return new Response(
        JSON.stringify({ error: "Recording consent not granted" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const egressToken = await createEgressApiToken();

    if (action === "start") {
      if (!room_name) {
        return new Response(
          JSON.stringify({ error: "room_name is required for start" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      logStep("Starting room composite egress", { room_name, session_id });

      const egressResponse = await fetch(`${livekitHost}/twirp/livekit.Egress/StartRoomCompositeEgress`, {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${egressToken}`,
        },
        body: JSON.stringify({
          room_name,
          file_outputs: [
            {
              file_type: 0, // MP4
              filepath: `recordings/${session_id}/{room_name}-{time}.mp4`,
              s3: {
                bucket: Deno.env.get("RECORDING_S3_BUCKET") ?? "evymo-recordings",
                region: Deno.env.get("RECORDING_S3_REGION") ?? "eu-central-1",
                access_key: Deno.env.get("RECORDING_S3_ACCESS_KEY") ?? "",
                secret: Deno.env.get("RECORDING_S3_SECRET_KEY") ?? "",
              },
            },
          ],
        }),
      });

      if (!egressResponse.ok) {
        const errText = await egressResponse.text();
        logStep("Egress start failed", { status: egressResponse.status, error: errText });
        return new Response(
          JSON.stringify({ egress_id: "", status: "failed" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const egressResult = await egressResponse.json();
      logStep("Egress started", { egress_id: egressResult.egress_id });

      // Track egress in consultation session
      await supabase
        .from("consultation_sessions")
        .update({ recording_egress_id: egressResult.egress_id })
        .eq("id", session_id);

      return new Response(
        JSON.stringify({ egress_id: egressResult.egress_id, status: "started" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "stop") {
      if (!egress_id) {
        return new Response(
          JSON.stringify({ error: "egress_id is required for stop" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      logStep("Stopping egress", { egress_id, session_id });

      const stopResponse = await fetch(`${livekitHost}/twirp/livekit.Egress/StopEgress`, {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${egressToken}`,
        },
        body: JSON.stringify({ egress_id }),
      });

      if (!stopResponse.ok) {
        const errText = await stopResponse.text();
        logStep("Egress stop failed", { status: stopResponse.status, error: errText });
        return new Response(
          JSON.stringify({ egress_id, status: "failed" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      logStep("Egress stopped", { egress_id });

      return new Response(
        JSON.stringify({ egress_id, status: "stopped" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action. Use 'start' or 'stop'" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    logStep("Error", { message: (error as Error).message });
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
