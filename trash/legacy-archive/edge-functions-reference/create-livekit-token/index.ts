import { serve, createClient } from "../_shared/deps.ts";
import { buildCorsHeaders, preflightResponse } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const livekitApiKey = Deno.env.get("LIVEKIT_API_KEY")!;
const livekitApiSecret = Deno.env.get("LIVEKIT_API_SECRET")!;

const LOG_PREFIX = "[CREATE-LIVEKIT-TKN]";
const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`${LOG_PREFIX} ${step}${detailsStr}`);
};

/**
 * Generate a LiveKit access token for a user.
 * Uses HMAC-SHA256 JWT signing (matching livekit-server-sdk pattern).
 *
 * Body: { roomName: string, identity?: string, canPublish?: boolean, canSubscribe?: boolean }
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

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);

    if (userError || !userData.user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const user = userData.user;
    logStep("User authenticated", { userId: user.id });

    const body = await req.json();
    const { roomName, canPublish = true, canSubscribe = true } = body;

    if (!roomName || typeof roomName !== "string") {
      return new Response(
        JSON.stringify({ error: "roomName is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify the user has access to the voice room
    const { data: voiceRoom, error: roomError } = await supabase
      .from("voice_rooms")
      .select("id, story_id, room_type, max_participants, is_active")
      .eq("livekit_room_name", roomName)
      .single();

    if (roomError || !voiceRoom) {
      return new Response(
        JSON.stringify({ error: "Room not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!voiceRoom.is_active) {
      return new Response(
        JSON.stringify({ error: "Room is closed" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If room is linked to a story, verify membership.
    // Note: table renamed from story_members → story_participants in
    // migration 20260416120000_voice_rooms_matrix. Archive kept here for
    // historical reference; the live runtime uses the
    // `check_story_membership` RPC from services/svc-livekit instead.
    if (voiceRoom.story_id) {
      const { data: membership } = await supabase
        .from("story_participants")
        .select("id")
        .eq("story_id", voiceRoom.story_id)
        .eq("user_id", user.id)
        .single();

      if (!membership) {
        return new Response(
          JSON.stringify({ error: "Not a member of this story" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Get display name for LiveKit identity
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .single();

    const identity = user.id;
    const name = profile?.display_name || "Anonymous";

    // Build LiveKit JWT
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 3600; // 1 hour

    const header = { alg: "HS256", typ: "JWT" };
    const payload = {
      iss: livekitApiKey,
      sub: identity,
      name,
      nbf: now,
      exp,
      iat: now,
      jti: crypto.randomUUID(),
      video: {
        room: roomName,
        roomJoin: true,
        canPublish,
        canSubscribe,
        canPublishData: true,
      },
      metadata: JSON.stringify({ userId: user.id, roomType: voiceRoom.room_type }),
    };

    const livekitToken = await signJwt(header, payload, livekitApiSecret);
    logStep("Token generated", { roomName, identity, roomType: voiceRoom.room_type });

    // Record participant join
    await supabase.from("call_participants").upsert(
      {
        voice_room_id: voiceRoom.id,
        user_id: user.id,
        joined_at: new Date().toISOString(),
        left_at: null,
        role: voiceRoom.room_type === "consultation" ? "participant" : "participant",
      },
      { onConflict: "voice_room_id,user_id" }
    );

    return new Response(
      JSON.stringify({ token: livekitToken, identity, name, roomName }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    logStep("ERROR", { message: (err as Error).message });
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ─── JWT Helper (HMAC-SHA256) ─────────────────────────────────
async function signJwt(
  header: Record<string, string>,
  payload: Record<string, unknown>,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const data = encoder.encode(`${headerB64}.${payloadB64}`);

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, data);
  const sigB64 = base64url(new Uint8Array(signature));

  return `${headerB64}.${payloadB64}.${sigB64}`;
}

function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const binString = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(binString).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
