// Edge function for secure health document downloads
import { serve } from "../_shared/deps.ts";

import {
  bearerTokenGuard,
  corsGuard,
  documentIdGuard,
} from "../_shared/analyzeTrackingDocumentGuards.ts";

import { preflightResponse, silentCorsDenyResponse } from "../_shared/cors.ts";
import { jsonResponse as jsonResponseBase } from "../_shared/http.ts";
import {
  createServiceRoleSupabaseClient,
  createUserSupabaseClient,
  requireSupabaseEnv,
} from "../_shared/supabase.ts";

import { getHealthDocumentDownloadConfig } from "../_shared/runtimeConfig.ts";

const downloadConfig = getHealthDocumentDownloadConfig();
const allowedOriginsRaw = downloadConfig.allowedOriginsRaw;
const DOWNLOADS_PER_HOUR = downloadConfig.downloadsPerHour;

function jsonResponse(
  req: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return jsonResponseBase(req, allowedOriginsRaw, body, status);
}

serve(async (req) => {
  const origin = req.headers.get("Origin");
  const corsFailure = corsGuard({
    origin,
    allowedOriginsRaw,
  });

  if (corsFailure) {
    // Silent deny for disallowed Origin (do not help attackers iterate).
    return silentCorsDenyResponse();
  }

  if (req.method === "OPTIONS") {
    return preflightResponse(req, allowedOriginsRaw);
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  const supabaseEnv = requireSupabaseEnv({ requireServiceRole: true });
  if (!supabaseEnv.ok) return jsonResponse(req, { error: supabaseEnv.error }, supabaseEnv.status);
  const { supabaseUrl, supabaseAnonKey, supabaseServiceKey } = supabaseEnv;

  const tokenResult = bearerTokenGuard({
    authorizationHeader: req.headers.get("Authorization"),
  });

  if ("status" in tokenResult) {
    return jsonResponse(req, { error: tokenResult.error }, tokenResult.status);
  }

  const token = tokenResult.token;

  interface DownloadRequestBody {
    documentId?: string;
  }

  let parsedBody: DownloadRequestBody;
  try {
    parsedBody = await req.json() as DownloadRequestBody;
  } catch {
    return jsonResponse(req, { error: "Invalid JSON body" }, 400);
  }

  const documentIdResult = documentIdGuard({ documentId: parsedBody.documentId });
  if ("status" in documentIdResult) {
    return jsonResponse(req, { error: documentIdResult.error }, documentIdResult.status);
  }

  const documentId = documentIdResult.documentId;

  // User-scoped client for authorization (RLS-enforced)
  const supabaseUser = createUserSupabaseClient({ supabaseUrl, supabaseAnonKey, token });

  const { data: userData, error: userError } = await supabaseUser.auth.getUser(
    token,
  );

  if (userError || !userData?.user) {
    return jsonResponse(req, { error: "Invalid token" }, 401);
  }

  const user = userData.user;

  // Service role is used for rate limit counting + Storage signing.
  const supabaseAdmin = createServiceRoleSupabaseClient({
    supabaseUrl,
    supabaseServiceKey: supabaseServiceKey!,
  });

  const { error: rateError } = await supabaseUser.rpc("enforce_rate_limit", {
    p_endpoint_key: "health_document_download",
    p_max_requests: DOWNLOADS_PER_HOUR,
    p_window_ms: 60 * 60 * 1000
  });

  if (rateError) {
    await supabaseAdmin.rpc("write_audit_journal", {
      p_action_type: "error",
      p_area: "documents",
      p_details: {
        result: "rate_limited",
        max_per_hour: DOWNLOADS_PER_HOUR,
        error: rateError.message,
      },
      p_entity_id: documentId,
      p_entity_type: "member_health_document",
      p_summary: "Health document download rate limited",
      p_user_id: user.id
    });

    return jsonResponse(req, { error: "Rate limit exceeded" }, 429);
  }

  const { data: docRows, error: docError } = await supabaseUser.rpc(
    "get_health_document_download_info_audited",
    { p_document_id: documentId },
  );
  const doc = docRows?.[0];

  if (docError || !doc?.id || !doc?.file_path) {
    // Do not leak existence; treat as not found.
    await supabaseAdmin.rpc("write_audit_journal", {
      p_action_type: "view",
      p_area: "documents",
      p_details: {
        result: "denied",
      },
      p_entity_id: documentId,
      p_entity_type: "member_health_document",
      p_summary: "Health document download denied",
      p_user_id: user.id
    });

    return jsonResponse(req, { error: "Not found" }, 404);
  }

  const expiresInSeconds = 300;
  const { data: signed, error: signError } = await supabaseAdmin.storage
    .from("health-documents")
    .createSignedUrl(doc.file_path, expiresInSeconds);

  if (signError || !signed?.signedUrl) {
    await supabaseAdmin.rpc("write_audit_journal", {
      p_action_type: "error",
      p_area: "documents",
      p_details: {
        result: "error",
      },
      p_entity_id: documentId,
      p_entity_type: "member_health_document",
      p_summary: "Health document download signing failed",
      p_user_id: user.id
    });

    return jsonResponse(req, { error: "Failed to create download URL" }, 500);
  }

  const via = doc.user_id === user.id ? "owner" : "share";

  await supabaseAdmin.rpc("write_audit_journal", {
    p_action_type: "view",
    p_area: "documents",
    p_details: {
      result: "granted",
      via,
      expires_in_seconds: expiresInSeconds,
    },
    p_entity_id: documentId,
    p_entity_type: "member_health_document",
    p_summary: "Health document download URL issued",
    p_user_id: user.id
  });

  return jsonResponse(req, {
    signedUrl: signed.signedUrl,
    expiresInSeconds,
  });
});
