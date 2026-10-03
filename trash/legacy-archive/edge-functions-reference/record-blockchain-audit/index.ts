// Edge function for recording blockchain audit entries
import { serve } from "../_shared/deps.ts";

import {
  allowlistGuard,
  bearerHeaderGuard,
  corsGuard,
  jsonBodyGuard,
  jsonContentTypeGuard,
  methodGuard,
  payloadSizeGuard,
  rateLimitGuard,
  requiredFieldsGuard,
} from "../_shared/recordBlockchainAuditGuards.ts";

import { preflightResponse, silentCorsDenyResponse } from "../_shared/cors.ts";
import { emptyResponse, jsonResponse as jsonResponseBase } from "../_shared/http.ts";
import {
  createAuthedSupabaseClient,
  createServiceRoleSupabaseClient,
  requireSupabaseEnv,
} from "../_shared/supabase.ts";

import {
  RECORD_BLOCKCHAIN_AUDIT_ALLOWED_EVENT_TYPES,
  RECORD_BLOCKCHAIN_AUDIT_ALLOWED_REFERENCE_TABLES,
} from "../_shared/allowlists.ts";
import { getRecordBlockchainAuditConfig } from "../_shared/runtimeConfig.ts";

const auditConfig = getRecordBlockchainAuditConfig();
const allowedOriginsRaw = auditConfig.allowedOriginsRaw;

function jsonResponse(
  req: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return jsonResponseBase(req, allowedOriginsRaw, body, status);
}

interface BlockchainAuditRequest {
  event_type: string;
  reference_table: string;
  reference_id: string;
  payload: Record<string, unknown>;
}

const MAX_REQUEST_BODY_BYTES = auditConfig.maxRequestBodyBytes;
const MAX_PAYLOAD_JSON_CHARS = auditConfig.maxPayloadJsonChars;
const AUDIT_REQUESTS_PER_HOUR = auditConfig.auditRequestsPerHour;

serve(async (req) => {
  const origin = req.headers.get("Origin");
  const corsFailure = corsGuard({ origin, allowedOriginsRaw });
  if (corsFailure) {
    // Silent deny for disallowed Origin (do not help attackers iterate).
    return silentCorsDenyResponse();
  }

  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return preflightResponse(req, allowedOriginsRaw);
  }

  const methodFailure = methodGuard({ method: req.method });
  if (methodFailure) {
    return emptyResponse(req, allowedOriginsRaw, methodFailure.status);
  }

  try {
    const supabaseEnv = requireSupabaseEnv({ requireServiceRole: true });
    if (!supabaseEnv.ok) return jsonResponse(req, { error: supabaseEnv.error }, supabaseEnv.status);
    const { supabaseUrl, supabaseAnonKey, supabaseServiceKey } = supabaseEnv;

    // Get authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse(req, { error: "Missing authorization header" }, 401);
    }

    const authFailure = bearerHeaderGuard({ authorizationHeader: authHeader });
    if (authFailure) {
      return jsonResponse(req, { error: authFailure.error }, authFailure.status);
    }

    const contentTypeFailure = jsonContentTypeGuard({
      contentTypeHeader: req.headers.get("Content-Type"),
    });

    if (contentTypeFailure) {
      return jsonResponse(req, { error: contentTypeFailure.error }, contentTypeFailure.status);
    }

    const supabase = createAuthedSupabaseClient({
      supabaseUrl,
      supabaseAnonKey,
      authorizationHeader: authHeader,
    });

    const supabaseAdmin = createServiceRoleSupabaseClient({
      supabaseUrl,
      supabaseServiceKey: supabaseServiceKey!,
    });

    // Verify JWT
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return jsonResponse(req, { error: "Unauthorized" }, 401);
    }

    // Check if user is admin or staff
    const { data: isAdmin, error: isAdminError } = await supabase.rpc("has_role", {
      p_role: "admin",
      p_user_id: user.id,
    });
    const { data: isStaff, error: isStaffError } = await supabase.rpc("has_role", {
      p_role: "staff",
      p_user_id: user.id,
    });

    if (isAdminError || isStaffError || (!isAdmin && !isStaff)) {
      return jsonResponse(req, { error: "Insufficient permissions" }, 403);
    }

    // Rate limit (per-user)
    const rateLimitWindowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: countResult, error: countError } = await supabaseAdmin.rpc("edge_blockchain_audit", {
      p_action: "count_requests",
      p_payload: {
        since: rateLimitWindowStart,
        user_id: user.id,
      },
    });

    if (countError) {
      return jsonResponse(req, { error: "Internal server error" }, 500);
    }

    const recentCount = (countResult as { count?: number } | null)?.count ?? 0;

    const rlFailure = rateLimitGuard({ recentCount, limit: AUDIT_REQUESTS_PER_HOUR });
    if (rlFailure) {
      return jsonResponse(req, { error: rlFailure.error }, rlFailure.status);
    }

    const bodyText = await req.text();
    const bodyResult = jsonBodyGuard<BlockchainAuditRequest>({
      bodyText,
      maxBodyBytes: MAX_REQUEST_BODY_BYTES,
    });

    if ("status" in bodyResult) {
      return jsonResponse(req, { error: bodyResult.error }, bodyResult.status);
    }

    const body = bodyResult.body;

    const requiredFailure = requiredFieldsGuard({
      event_type: body.event_type,
      reference_table: body.reference_table,
      reference_id: body.reference_id,
      payload: body.payload,
    });
    if (requiredFailure) {
      return jsonResponse(req, { error: requiredFailure.error }, requiredFailure.status);
    }

    const eventFailure = allowlistGuard({
      value: body.event_type,
      allowlist: RECORD_BLOCKCHAIN_AUDIT_ALLOWED_EVENT_TYPES,
      error: "Invalid event type",
    });
    if (eventFailure) {
      return jsonResponse(req, { error: eventFailure.error }, eventFailure.status);
    }

    const refTableFailure = allowlistGuard({
      value: body.reference_table,
      allowlist: RECORD_BLOCKCHAIN_AUDIT_ALLOWED_REFERENCE_TABLES,
      error: "Invalid reference table",
    });
    if (refTableFailure) {
      return jsonResponse(req, { error: refTableFailure.error }, refTableFailure.status);
    }

    const payloadSizeResult = payloadSizeGuard({
      payload: body.payload,
      maxJsonChars: MAX_PAYLOAD_JSON_CHARS,
    });

    if ("status" in payloadSizeResult) {
      return jsonResponse(req, { error: payloadSizeResult.error }, payloadSizeResult.status);
    }

    const payloadString = payloadSizeResult.payloadJson;

    // Generate payload hash (SHA-256)
    const encoder = new TextEncoder();
    const data = encoder.encode(payloadString);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const payloadHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

    // Create audit record (queued for later blockchain sync).
    const { data: auditRecordData, error: insertError } = await supabase.rpc("edge_blockchain_audit", {
      p_action: "insert_record",
      p_payload: {
        created_by: user.id,
        event_type: body.event_type,
        payload: body.payload,
        payload_hash: payloadHash,
        reference_id: body.reference_id,
        reference_table: body.reference_table,
      },
    });

    if (insertError) {
      throw insertError;
    }

    const auditRecordId = (auditRecordData as { id?: string } | null)?.id;
    if (!auditRecordId) {
      throw new Error("Failed to create blockchain audit record");
    }

    await supabaseAdmin.rpc("write_audit_journal", {
      p_action_type: "integration",
      p_area: "blockchain",
      p_details: {
        event_type: body.event_type,
        reference_table: body.reference_table,
        reference_id: body.reference_id,
        status: "pending",
      },
      p_entity_id: auditRecordId,
      p_entity_type: "blockchain_audit",
      p_summary: "Blockchain audit queued",
      p_user_id: user.id
    });

    return jsonResponse(
      req,
      {
        success: true,
        audit_id: auditRecordId,
        status: "pending",
      },
      200,
    );

  } catch (err) {
    // Log full error server-side but return a generic message to clients —
    // never leak internal details (stack traces, IDs) in the response body.
    console.error("[record-blockchain-audit] handler failed:", err);
    return jsonResponse(req, { error: "Internal server error" }, 500);
  }
});
