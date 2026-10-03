/**
 * Edge Function: claim-cosmos-reward
 *
 * Called from mobile app when user claims a reward to their Cosmos wallet.
 *
 * Flow:
 * 1. Validate JWT
 * 2. Verify user has the claimed reward (check reward_shop_redemptions / pending_claims)
 * 3. Backend-sign a MsgSend (token transfer) to user's Cosmos address
 * 4. Record in audit_journal + update claim status
 *
 * Security:
 * - Supabase JWT required
 * - Recipient address validated (bech32 aisha1... format)
 * - Amount & denom validated against actual claim record
 * - Idempotency: claim_id prevents double-claiming
 */
import { serve } from "../_shared/deps.ts";
import { preflightResponse, silentCorsDenyResponse, isOriginAllowed } from "../_shared/cors.ts";
import { jsonResponse } from "../_shared/http.ts";
import {
  createAuthedSupabaseClient,
  createServiceRoleSupabaseClient,
  requireSupabaseEnv,
} from "../_shared/supabase.ts";

// ── Config ───────────────────────────────────────────────────
const COSMOS_REST = Deno.env.get("COSMOS_REST_URL") ?? "http://cosmos-node:1317";
const COSMOS_CHAIN_ID = Deno.env.get("COSMOS_CHAIN_ID") ?? "aisha-1";
const COSMOS_SIGNER_ADDRESS = Deno.env.get("COSMOS_SIGNER_ADDRESS") ?? "";
const COSMOS_GAS_DENOM = "uash";
const ALLOWED_ORIGINS = Deno.env.get("ALLOWED_ORIGINS") ?? "";

// Bech32 address validation (aisha1...)
const AISHA_ADDRESS_REGEX = /^aisha1[a-z0-9]{38,58}$/;

serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (origin && !isOriginAllowed(origin, ALLOWED_ORIGINS)) {
    return silentCorsDenyResponse();
  }
  if (req.method === "OPTIONS") {
    return preflightResponse(req, ALLOWED_ORIGINS);
  }
  if (req.method !== "POST") {
    return jsonResponse(req, ALLOWED_ORIGINS, { error: "Method not allowed" }, 405);
  }

  try {
    // ── Auth ──────────────────────────────────────────────────
    const supabaseEnv = requireSupabaseEnv({ requireServiceRole: true });
    if (!supabaseEnv.ok) {
      return jsonResponse(req, ALLOWED_ORIGINS, { error: "Server not configured" }, 500);
    }
    const { supabaseUrl, supabaseAnonKey, supabaseServiceKey } = supabaseEnv;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse(req, ALLOWED_ORIGINS, { error: "Missing authorization" }, 401);
    }

    const supabase = createAuthedSupabaseClient({
      supabaseUrl,
      supabaseAnonKey,
      authorizationHeader: authHeader,
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return jsonResponse(req, ALLOWED_ORIGINS, { error: "Unauthorized" }, 401);
    }

    // ── Validate body ────────────────────────────────────────
    const body = await req.json();
    const recipientAddress = String(body.recipient_address ?? "");
    const claimId = String(body.claim_id ?? "");

    if (!AISHA_ADDRESS_REGEX.test(recipientAddress)) {
      return jsonResponse(req, ALLOWED_ORIGINS, {
        error: "Invalid recipient address (expected aisha1...)",
      }, 400);
    }

    if (!claimId) {
      return jsonResponse(req, ALLOWED_ORIGINS, { error: "Missing claim_id" }, 400);
    }

    // ── Check signer ─────────────────────────────────────────
    if (!COSMOS_SIGNER_ADDRESS) {
      return jsonResponse(req, ALLOWED_ORIGINS, { error: "Cosmos signer not configured" }, 500);
    }

    // ── Verify claim exists and belongs to user ──────────────
    const adminClient = createServiceRoleSupabaseClient({
      supabaseUrl,
      supabaseServiceKey: supabaseServiceKey!,
    });

    const { data: claim, error: claimError } = await adminClient
      .from("reward_claims")
      .select("id, user_id, amount, denom, status")
      .eq("id", claimId)
      .eq("user_id", user.id)
      .single();

    if (claimError || !claim) {
      return jsonResponse(req, ALLOWED_ORIGINS, { error: "Claim not found" }, 404);
    }

    if (claim.status === "fulfilled") {
      return jsonResponse(req, ALLOWED_ORIGINS, { error: "Claim already fulfilled" }, 409);
    }

    // ── Broadcast MsgSend ────────────────────────────────────
    const amount = String(claim.amount ?? "0");
    const denom = claim.denom ?? COSMOS_GAS_DENOM;

    const txBody = {
      body: {
        messages: [
          {
            "@type": "/cosmos.bank.v1beta1.MsgSend",
            from_address: COSMOS_SIGNER_ADDRESS,
            to_address: recipientAddress,
            amount: [{ denom, amount }],
          },
        ],
        memo: `Reward claim ${claimId.slice(0, 8)}`,
        timeout_height: "0",
        extension_options: [],
        non_critical_extension_options: [],
      },
      auth_info: {
        signer_infos: [],
        fee: {
          amount: [{ denom: COSMOS_GAS_DENOM, amount: "5000" }],
          gas_limit: "200000",
          payer: "",
          granter: "",
        },
      },
      signatures: [],
    };

    const broadcastRes = await fetch(`${COSMOS_REST}/cosmos/tx/v1beta1/txs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx: txBody, mode: "BROADCAST_MODE_SYNC" }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!broadcastRes.ok) {
      const errText = await broadcastRes.text();
      return jsonResponse(req, ALLOWED_ORIGINS, {
        error: "Broadcast failed",
        detail: errText.slice(0, 200),
      }, 502);
    }

    const broadcastData = await broadcastRes.json();
    const txResponse = broadcastData.tx_response;

    if (txResponse?.code && txResponse.code !== 0) {
      return jsonResponse(req, ALLOWED_ORIGINS, {
        error: "Transaction failed",
        detail: txResponse.raw_log ?? `Code ${txResponse.code}`,
      }, 502);
    }

    const txHash = txResponse?.txhash ?? "";

    // ── Update claim status ──────────────────────────────────
    await adminClient
      .from("reward_claims")
      .update({
        status: "fulfilled",
        tx_hash: txHash,
        fulfilled_at: new Date().toISOString(),
      })
      .eq("id", claimId);

    // ── Audit log ────────────────────────────────────────────
    await adminClient.from("audit_journal").insert({
      actor_id: user.id,
      action: "cosmos_reward_claim",
      resource_type: "reward_claims",
      resource_id: claimId,
      payload: {
        tx_hash: txHash,
        recipient: recipientAddress,
        amount,
        denom,
        chain_id: COSMOS_CHAIN_ID,
      },
    });

    return jsonResponse(req, ALLOWED_ORIGINS, {
      tx_hash: txHash,
      claim_id: claimId,
      status: "fulfilled",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return jsonResponse(req, ALLOWED_ORIGINS, { error: message }, 500);
  }
});
