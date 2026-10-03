import { serve, createClient } from "../_shared/deps.ts";
import { buildCorsHeaders, preflightResponse } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const synapseAdminUrl = Deno.env.get("SYNAPSE_ADMIN_URL") || "http://synapse:8008";
const synapseSharedSecret = Deno.env.get("SYNAPSE_REGISTRATION_SECRET")!;

const LOG_PREFIX = "[MATRIX-TKN-EXCHANGE]";
const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`${LOG_PREFIX} ${step}${detailsStr}`);
};

/**
 * Exchange a Supabase GoTrue JWT for a Matrix access token.
 * Uses Synapse's admin API to login as the user (shared registration secret).
 *
 * This enables the Evymo app to use matrix-js-sdk with the user's Matrix account
 * without requiring a separate Matrix login flow.
 *
 * Flow:
 * 1. Validate GoTrue JWT → get user identity
 * 2. Ensure Matrix account exists (create via admin API if not)
 * 3. Login as user → return Matrix access token
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

    // Get display name from profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, username")
      .eq("id", user.id)
      .single();

    // Matrix localpart: use username or sanitized user ID
    const localpart = (profile?.username || user.id).toLowerCase().replace(/[^a-z0-9._=-]/g, "_");
    const matrixUserId = `@${localpart}:matrix.id3a.cz`;

    logStep("Matrix identity", { localpart, matrixUserId });

    // Generate admin HMAC nonce for registration
    // Step 1: Get nonce from Synapse
    const nonceResp = await fetch(`${synapseAdminUrl}/_synapse/admin/v1/register`, {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    });

    if (!nonceResp.ok) {
      logStep("Nonce fetch failed", { status: nonceResp.status });
      return new Response(
        JSON.stringify({ error: "Matrix server unavailable" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { nonce } = await nonceResp.json();

    // Step 2: Generate HMAC for admin registration
    const mac = await generateHmac(
      nonce,
      localpart,
      synapseSharedSecret,
      false // not admin
    );

    // Step 3: Register user (idempotent — returns 400 if exists, which is fine)
    const displayName = profile?.display_name || localpart;
    const registerResp = await fetch(`${synapseAdminUrl}/_synapse/admin/v1/register`, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nonce,
        username: localpart,
        displayname: displayName,
        password: crypto.randomUUID(), // Random password (user logs in via OIDC)
        admin: false,
        mac,
      }),
    });

    let matrixAccessToken: string;

    if (registerResp.ok) {
      // New user registered
      const regData = await registerResp.json();
      matrixAccessToken = regData.access_token;
      logStep("Matrix user registered", { matrixUserId });
    } else {
      // User already exists — login via admin API
      logStep("User exists, logging in via admin API");

      const loginResp = await fetch(
        `${synapseAdminUrl}/_synapse/admin/v1/users/${encodeURIComponent(matrixUserId)}/login`,
        {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SYNAPSE_ADMIN_TOKEN")}`,
          },
          body: JSON.stringify({}),
        }
      );

      if (!loginResp.ok) {
        const errText = await loginResp.text();
        logStep("Admin login failed", { status: loginResp.status, body: errText });
        return new Response(
          JSON.stringify({ error: "Matrix login failed" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const loginData = await loginResp.json();
      matrixAccessToken = loginData.access_token;
      logStep("Matrix login successful", { matrixUserId });
    }

    return new Response(
      JSON.stringify({
        access_token: matrixAccessToken,
        user_id: matrixUserId,
        home_server: "matrix.id3a.cz",
      }),
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

/**
 * Generate HMAC for Synapse admin registration API.
 * Format: HMAC-SHA1(nonce\0username\0password\0admin|notadmin)
 */
async function generateHmac(
  nonce: string,
  username: string,
  sharedSecret: string,
  admin: boolean
): Promise<string> {
  const encoder = new TextEncoder();
  const message = `${nonce}\0${username}\0${crypto.randomUUID()}\0${admin ? "admin" : "notadmin"}`;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(sharedSecret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
