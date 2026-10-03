// Edge function for health document upload preflight
import { serve } from "../_shared/deps.ts";

import { bearerTokenGuard, corsGuard } from "../_shared/analyzeTrackingDocumentGuards.ts";
import { preflightResponse, silentCorsDenyResponse } from "../_shared/cors.ts";
import { jsonResponse as jsonResponseBase } from "../_shared/http.ts";
import {
  createServiceRoleSupabaseClient,
  createUserSupabaseClient,
  requireSupabaseEnv,
} from "../_shared/supabase.ts";
import {
  categoryGuard,
  filenameGuard,
  parsePreflightBody,
  resolveMimeType,
  sanitizeFilename,
  sizeGuard,
} from "../_shared/uploadTrackingDocumentPreflightGuards.ts";

import {
  UPLOAD_HEALTH_DOCUMENT_ALLOWED_CATEGORIES,
  UPLOAD_HEALTH_DOCUMENT_ALLOWED_MIME_TYPES,
} from "../_shared/allowlists.ts";
import { getUploadHealthDocumentPreflightConfig } from "../_shared/runtimeConfig.ts";

const preflightConfig = getUploadHealthDocumentPreflightConfig();
const allowedOriginsRaw = preflightConfig.allowedOriginsRaw;
const MAX_FILE_SIZE_BYTES = preflightConfig.maxFileSizeBytes;
const UPLOAD_PREFLIGHTS_PER_HOUR = preflightConfig.preflightsPerHour;

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

  interface PreflightRequestBody {
    filename?: string;
    mimeType?: string;
    size?: number;
    category?: string;
    title?: string;
    description?: string;
    documentDate?: string;
    studyRegistrationId?: string;
  }

  let body: PreflightRequestBody;
  try {
    body = await req.json() as PreflightRequestBody;
  } catch {
    return jsonResponse(req, { error: "Invalid JSON body" }, 400);
  }

  const parsed = parsePreflightBody(body);

  const filenameFailure = filenameGuard({ filename: parsed.filename });
  if (filenameFailure) {
    return jsonResponse(req, { error: filenameFailure.error }, filenameFailure.status);
  }

  const sizeFailure = sizeGuard({ size: parsed.size, maxBytes: MAX_FILE_SIZE_BYTES });
  if (sizeFailure) {
    return jsonResponse(req, { error: sizeFailure.error }, sizeFailure.status);
  }

  const categoryFailure = categoryGuard({
    category: parsed.category,
    allowedCategories: UPLOAD_HEALTH_DOCUMENT_ALLOWED_CATEGORIES,
  });
  if (categoryFailure) {
    return jsonResponse(req, { error: categoryFailure.error }, categoryFailure.status);
  }

  const mimeResult = resolveMimeType({
    filename: parsed.filename,
    providedMimeType: parsed.providedMimeType,
    allowedMimeTypes: UPLOAD_HEALTH_DOCUMENT_ALLOWED_MIME_TYPES,
  });

  if ("status" in mimeResult) {
    return jsonResponse(req, { error: mimeResult.error }, mimeResult.status);
  }

  const filename = parsed.filename;
  const size = parsed.size;
  const category = parsed.category;
  const title = parsed.title;
  const description = parsed.description;
  const documentDate = parsed.documentDate;
  const studyRegistrationId = parsed.studyRegistrationId;
  const resolvedMimeType = mimeResult.mimeType;

  // User-scoped client for authentication + DB writes (RLS-enforced)
  const supabaseUser = createUserSupabaseClient({ supabaseUrl, supabaseAnonKey, token });

  const { data: userData, error: userError } = await supabaseUser.auth.getUser(
    token,
  );
  if (userError || !userData?.user) {
    return jsonResponse(req, { error: "Invalid token" }, 401);
  }

  const user = userData.user;

  // Service role client used only for rate limit counting + Storage signing.
  const supabaseAdmin = createServiceRoleSupabaseClient({
    supabaseUrl,
    supabaseServiceKey: supabaseServiceKey!,
  });

  const { error: rateError } = await supabaseUser.rpc("enforce_rate_limit", {
    p_endpoint_key: "health_document_upload_preflight",
    p_max_requests: UPLOAD_PREFLIGHTS_PER_HOUR,
    p_window_ms: 60 * 60 * 1000
  });

  if (rateError) {
    await supabaseAdmin.rpc("write_audit_journal", {
      p_action_type: "error",
      p_area: "documents",
      p_details: {
        result: "rate_limited",
        max_per_hour: UPLOAD_PREFLIGHTS_PER_HOUR,
        error: rateError.message,
      },
      p_entity_id: null,
      p_entity_type: "member_health_document",
      p_summary: "Health document upload preflight rate limited",
      p_user_id: user.id
    });

    return jsonResponse(req, { error: "Rate limit exceeded" }, 429);
  }

  const safeName = sanitizeFilename(filename);
  const filePath = `${user.id}/${crypto.randomUUID()}_${safeName}`;

  const { data: docRows, error: insertError } = await supabaseUser.rpc(
    "create_health_document_preflight_audited",
    {
      p_category: category,
      p_description: description,
      p_document_date: documentDate,
      p_file_name: filename,
      p_file_path: filePath,
      p_file_size: Math.trunc(size),
      p_mime_type: resolvedMimeType,
      p_study_registration_id: studyRegistrationId,
      p_title: title
    },
  );

  const doc = docRows?.[0];

  if (insertError || !doc?.id || !doc?.file_path) {
    await supabaseAdmin.rpc("write_audit_journal", {
      p_action_type: "error",
      p_area: "documents",
      p_details: {
        result: "error",
      },
      p_entity_id: null,
      p_entity_type: "member_health_document",
      p_summary: "Health document upload preflight insert failed",
      p_user_id: user.id
    });

    return jsonResponse(req, { error: "Failed to create document" }, 500);
  }

  const { data: signed, error: signError } = await supabaseAdmin.storage
    .from("health-documents")
    .createSignedUploadUrl(doc.file_path);

  if (signError || !signed?.token || !signed?.path) {
    // Best-effort cleanup: if signing fails, remove the DB row to avoid orphans.
    await supabaseUser.rpc("delete_my_health_document_audited", {
      p_document_id: doc.id,
    });

    await supabaseAdmin.rpc("write_audit_journal", {
      p_action_type: "error",
      p_area: "documents",
      p_details: {
        result: "error",
      },
      p_entity_id: doc.id,
      p_entity_type: "member_health_document",
      p_summary: "Health document upload preflight signing failed",
      p_user_id: user.id
    });

    return jsonResponse(req, { error: "Failed to create upload URL" }, 500);
  }

  // Signed upload URLs are valid for 2 hours (Supabase Storage behavior).
  const expiresInSeconds = 2 * 60 * 60;

  await supabaseAdmin.rpc("write_audit_journal", {
    p_action_type: "create",
    p_area: "documents",
    p_details: {
      result: "granted",
      expires_in_seconds: expiresInSeconds,
    },
    p_entity_id: doc.id,
    p_entity_type: "member_health_document",
    p_summary: "Health document upload preflight granted",
    p_user_id: user.id
  });

  return jsonResponse(req, {
    documentId: doc.id,
    path: signed.path,
    token: signed.token,
    signedUrl: signed.signedUrl,
    expiresInSeconds,
    mimeType: resolvedMimeType,
  });
});
