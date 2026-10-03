/**
 * Verify SMS OTP Edge Function
 *
 * Verifies OTP codes sent via SMS.
 * All business logic (hash comparison, expiry, attempt limits) is in the
 * database function `edge_sms_otp('verify', ...)`. This edge function is
 * a thin validation + routing layer.
 */

import { serve, createClient } from "../_shared/deps.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface VerifyRequest {
  phone: string;
  code: string;
}

interface VerifyResult {
  valid: boolean;
  error?: string;
  attempts_remaining?: number;
}

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body: VerifyRequest = await req.json();
    const { phone, code } = body;

    // Input validation (format only — business logic is in DB)
    if (!phone || !/^\+\d{10,15}$/.test(phone)) {
      return new Response(
        JSON.stringify({ valid: false, error: "Invalid phone number" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!code || !/^\d{4,8}$/.test(code)) {
      return new Response(
        JSON.stringify({ valid: false, error: "Invalid OTP code" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Connect to database
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Delegate verification entirely to DB (hash check, expiry, attempts)
    const { data, error: rpcError } = await supabase.rpc("edge_sms_otp", {
      p_action: "verify",
      p_payload: { code, phone },
    });

    if (rpcError) {
      console.error("Verify OTP RPC error (no PII):", rpcError.message);
      return new Response(
        JSON.stringify({ valid: false, error: "Verification failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = data as VerifyResult;

    // Map DB error codes to user-friendly messages
    if (!result.valid) {
      const errorMessages: Record<string, string> = {
        not_found: "No OTP found for this phone",
        already_used: "OTP already used",
        expired: "OTP expired",
        max_attempts: "Too many attempts. Request new code.",
        invalid_code: "Invalid code",
      };

      return new Response(
        JSON.stringify({
          valid: false,
          error: errorMessages[result.error ?? ""] ?? "Verification failed",
          ...(result.attempts_remaining != null
            ? { attemptsRemaining: result.attempts_remaining }
            : {}),
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ valid: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Verify OTP error:", error);
    return new Response(
      JSON.stringify({ valid: false, error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
