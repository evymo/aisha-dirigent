/**
 * Edge Function: blockchain-dispatch
 *
 * Lightweight dispatcher that picks queued blockchain_audit_records
 * (via retry_pending_blockchain_syncs RPC) and publishes each to
 * RabbitMQ `aisha.blockchain.sync` queue for processing.
 *
 * Invoked by:
 *   - pg_notify('blockchain_sync') → pg_net POST (real-time)
 *   - n8n cron / manual trigger (catch-up)
 *
 * Security:
 *   - Service-role only (same as retry_pending_blockchain_syncs RPC)
 *
 * @module
 */
import { serve } from "../_shared/deps.ts";
import {
  createServiceRoleSupabaseClient,
  requireSupabaseEnv,
} from "../_shared/supabase.ts";
import { publishBlockchainSync } from "../_shared/mqClient.ts";

import type { BlockchainSyncMessage } from "../_shared/mqClient.ts";

// ── Config ───────────────────────────────────────────────────
const DEFAULT_BATCH_SIZE = 20;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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

    // ── Parse optional batch_size from body ──────────────────
    let batchSize = DEFAULT_BATCH_SIZE;
    try {
      const body = await req.json();
      if (body?.batch_size && typeof body.batch_size === "number") {
        batchSize = Math.min(Math.max(body.batch_size, 1), 100);
      }
    } catch {
      // Empty body is fine — use default
    }

    // ── Pick queued records via RPC ──────────────────────────
    const { data: records, error: rpcError } = await adminClient.rpc(
      "retry_pending_blockchain_syncs",
      { p_batch_size: batchSize },
    );

    if (rpcError) {
      return jsonRes({
        error: "RPC failed",
        detail: rpcError.message,
      }, 500);
    }

    if (!records || !Array.isArray(records) || records.length === 0) {
      return jsonRes({ dispatched: 0, message: "No queued records" }, 200);
    }

    // ── Publish each record to RabbitMQ ──────────────────────
    let published = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const record of records) {
      const message: BlockchainSyncMessage = {
        audit_record_id: record.id,
        correlation_id: record.correlation_id ?? record.id,
        event_type: record.record_type,
        reference_table: record.reference_table,
        reference_id: record.reference_id,
        token_transaction_id: record.token_transaction_id ?? null,
        retry_count: record.retry_count ?? 0,
        dispatched_at: new Date().toISOString(),
      };

      const ok = await publishBlockchainSync(message);
      if (ok) {
        published++;
      } else {
        failed++;
        errors.push(`Failed to publish record ${record.id}`);
      }
    }

    return jsonRes({
      dispatched: published,
      failed,
      total: records.length,
      errors: errors.length > 0 ? errors : undefined,
    }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return jsonRes({ error: message }, 500);
  }
});

// ── Helper ───────────────────────────────────────────────────
function jsonRes(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
