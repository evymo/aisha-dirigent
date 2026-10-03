/**
 * Edge Function: cosmos-ledger-sync
 *
 * Queue consumer that processes a single blockchain_audit_record,
 * syncing the corresponding token operation to the Cosmos chain.
 *
 * Called by n8n WF_BLOCKCHAIN_SYNC (RabbitMQ consumer) with a
 * BlockchainSyncMessage payload per queued record.
 *
 * Flow:
 *   1. Mark record as 'processing'
 *   2. Circuit breaker: check Cosmos node health
 *   3. Look up original token_transaction
 *   4. Broadcast MsgSend (for awards to users with Cosmos address)
 *   5. Update record: confirmed (+ tx_hash) or failed (+ error_message)
 *
 * GDPR: Only governance + aisha tokens are synced (data + impact = NEVER on-chain).
 *
 * Security:
 *   - Service-role only (called by n8n, not user)
 *   - Idempotent: skips already-confirmed records
 *
 * @module
 */
import { serve } from "../_shared/deps.ts";
import {
  createServiceRoleSupabaseClient,
  requireSupabaseEnv,
} from "../_shared/supabase.ts";

// ── Config ───────────────────────────────────────────────────
const COSMOS_REST = Deno.env.get("COSMOS_REST_URL") ?? "http://cosmos-node:1317";
const COSMOS_CHAIN_ID = Deno.env.get("COSMOS_CHAIN_ID") ?? "aisha-1";
const COSMOS_SIGNER_ADDRESS = Deno.env.get("COSMOS_SIGNER_ADDRESS") ?? "";
const COSMOS_GAS_DENOM = "uash";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CIRCUIT_BREAKER_TIMEOUT_MS = 5_000;

serve(async (req) => {
  // ── Auth: service-role only ────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || authHeader !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return jsonRes({ error: "Unauthorized" }, 401);
  }

  if (req.method !== "POST") {
    return jsonRes({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseEnv = requireSupabaseEnv({ requireServiceRole: true });
    if (!supabaseEnv.ok) {
      return jsonRes({ error: "Server not configured" }, 500);
    }

    const adminClient = createServiceRoleSupabaseClient({
      supabaseUrl: supabaseEnv.supabaseUrl,
      supabaseServiceKey: supabaseEnv.supabaseServiceKey!,
    });

    const body = await req.json();
    const {
      audit_record_id,
      reference_table,
      reference_id,
    } = body;

    if (!audit_record_id) {
      return jsonRes({ error: "Missing audit_record_id" }, 400);
    }

    // ── Idempotency: skip already confirmed ──────────────────
    const { data: auditRecord, error: fetchErr } = await adminClient
      .from("blockchain_audit_records")
      .select("id, status, record_type, data, cosmos_tx_hash, retry_count, max_attempts")
      .eq("id", audit_record_id)
      .single();

    if (fetchErr || !auditRecord) {
      return jsonRes({ error: "Audit record not found", audit_record_id }, 404);
    }

    if (auditRecord.status === "confirmed") {
      return jsonRes({
        skipped: true,
        reason: "Already confirmed",
        cosmos_tx_hash: auditRecord.cosmos_tx_hash,
      }, 200);
    }

    if (auditRecord.status === "exhausted") {
      return jsonRes({
        skipped: true,
        reason: "Max retries exhausted — check DLQ",
      }, 200);
    }

    // ── Mark as processing ───────────────────────────────────
    await adminClient
      .from("blockchain_audit_records")
      .update({
        status: "processing",
        processing_started_at: new Date().toISOString(),
      })
      .eq("id", audit_record_id);

    // ── Circuit breaker: Cosmos health check ─────────────────
    const cosmosHealthy = await checkCosmosHealth();
    if (!cosmosHealthy) {
      // Revert to queued — will be retried later
      await adminClient
        .from("blockchain_audit_records")
        .update({
          status: "queued",
          processing_started_at: null,
          error_message: "Circuit breaker: Cosmos node unreachable",
        })
        .eq("id", audit_record_id);

      return jsonRes({
        error: "Cosmos node unreachable",
        circuit_breaker: true,
        audit_record_id,
      }, 503);
    }

    // ── Load original transaction data ───────────────────────
    const payload = auditRecord.data as Record<string, unknown> | null;
    const tokenType = (payload?.token_type as string) ?? "";
    const actionType = (payload?.action_type as string) ?? auditRecord.record_type;
    const amount = (payload?.amount as number) ?? 0;
    const userId = (payload?.user_id as string) ?? "";

    // ── Get user's Cosmos address (if registered) ────────────
    let userCosmosAddress: string | null = null;
    if (userId) {
      const { data: profile } = await adminClient
        .from("profiles")
        .select("cosmos_address")
        .eq("id", userId)
        .single();
      userCosmosAddress = profile?.cosmos_address ?? null;
    }

    // ── Attempt Cosmos broadcast ─────────────────────────────
    let txHash = "";
    let syncError = "";

    const isAward = actionType === "award" || actionType === "token_award";
    if (isAward && userCosmosAddress && COSMOS_SIGNER_ADDRESS && amount > 0) {
      const txResult = await broadcastMsgSend({
        fromAddress: COSMOS_SIGNER_ADDRESS,
        toAddress: userCosmosAddress,
        amount: String(amount),
        denom: tokenType === "aisha" ? COSMOS_GAS_DENOM : `u${tokenType}`,
        memo: `Sync: ${actionType} ${tokenType} ref:${reference_table}/${reference_id}`,
      });

      if (txResult.success) {
        txHash = txResult.txHash;
      } else {
        syncError = txResult.error ?? "Unknown broadcast error";
      }
    } else if (isAward && !userCosmosAddress) {
      // User has no Cosmos address — record as confirmed (off-chain only)
      txHash = "";
      syncError = "";
    }

    // ── Update audit record with result ──────────────────────
    if (txHash || (!isAward) || (isAward && !userCosmosAddress)) {
      // Success or non-broadcast event
      await adminClient
        .from("blockchain_audit_records")
        .update({
          status: "confirmed",
          cosmos_tx_hash: txHash || null,
          processing_started_at: null,
          error_message: null,
        })
        .eq("id", audit_record_id);

      return jsonRes({
        success: true,
        audit_record_id,
        status: "confirmed",
        cosmos_tx_hash: txHash || null,
      }, 200);
    } else {
      // Broadcast failed — mark as failed for retry
      const retryCount = (auditRecord.retry_count ?? 0) + 1;
      const maxAttempts = auditRecord.max_attempts ?? 3;
      const newStatus = retryCount >= maxAttempts ? "exhausted" : "failed";

      const nextRetryAt = newStatus === "failed"
        ? new Date(Date.now() + Math.pow(3, retryCount) * 60_000).toISOString()
        : null;

      await adminClient
        .from("blockchain_audit_records")
        .update({
          status: newStatus,
          retry_count: retryCount,
          processing_started_at: null,
          error_message: syncError,
          next_retry_at: nextRetryAt,
        })
        .eq("id", audit_record_id);

      return jsonRes({
        success: false,
        audit_record_id,
        status: newStatus,
        error: syncError,
        retry_count: retryCount,
      }, newStatus === "exhausted" ? 410 : 502);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return jsonRes({ error: message }, 500);
  }
});

// ── Circuit breaker: Cosmos node health ──────────────────────
async function checkCosmosHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${COSMOS_REST}/cosmos/base/tendermint/v1beta1/syncing`, {
      signal: AbortSignal.timeout(CIRCUIT_BREAKER_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const data = await res.json();
    // Node is healthy if it exists and is not syncing
    return data?.syncing === false;
  } catch {
    return false;
  }
}

// ── Cosmos broadcast helper ──────────────────────────────────
async function broadcastMsgSend(params: {
  fromAddress: string;
  toAddress: string;
  amount: string;
  denom: string;
  memo: string;
}): Promise<{ success: boolean; txHash: string; error?: string }> {
  const { fromAddress, toAddress, amount, denom, memo } = params;

  const txBody = {
    body: {
      messages: [
        {
          "@type": "/cosmos.bank.v1beta1.MsgSend",
          from_address: fromAddress,
          to_address: toAddress,
          amount: [{ denom, amount }],
        },
      ],
      memo,
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

  try {
    const res = await fetch(`${COSMOS_REST}/cosmos/tx/v1beta1/txs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx: txBody, mode: "BROADCAST_MODE_SYNC" }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return { success: false, txHash: "", error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const txResponse = data.tx_response;

    if (txResponse?.code && txResponse.code !== 0) {
      return {
        success: false,
        txHash: txResponse.txhash ?? "",
        error: txResponse.raw_log ?? `Code ${txResponse.code}`,
      };
    }

    return { success: true, txHash: txResponse?.txhash ?? "" };
  } catch (err) {
    return {
      success: false,
      txHash: "",
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

// ── Response helper ──────────────────────────────────────────
function jsonRes(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
