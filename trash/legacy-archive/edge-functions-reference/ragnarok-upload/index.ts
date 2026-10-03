/**
 * Edge Function: ragnarok-upload
 *
 * Proxy for uploading documents to Ragnarok knowledge base.
 * Accepts authenticated requests (admin/staff only) and forwards
 * file uploads to Ragnarok's `/knowledge_base/file` endpoint.
 *
 * Also provides list/delete operations on knowledge bases.
 *
 * POST /ragnarok-upload  { action: "upload", file: File, ... }
 * POST /ragnarok-upload  { action: "list", project_id?: string }
 * POST /ragnarok-upload  { action: "delete", kb_id: string, project_id?: string }
 *
 * Environment:
 *   - RAGNAROK_URL (e.g. http://ragnarok:9696)
 *   - RAGNAROK_API_KEY
 *
 * @module
 */

import { serve, createClient } from "../_shared/deps.ts";
import { corsGuard } from "../_shared/analyzeTrackingDocumentGuards.ts";
import {
  preflightResponse,
  silentCorsDenyResponse,
} from "../_shared/cors.ts";
import { jsonResponse as jsonResponseBase } from "../_shared/http.ts";
import { getAllowedOriginsRaw } from "../_shared/runtimeConfig.ts";

const allowedOriginsRaw = getAllowedOriginsRaw();

function jsonResponse(
  req: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return jsonResponseBase(req, allowedOriginsRaw, body, status);
}

const DEFAULT_PROJECT_ID = "evymo";

/**
 * Verify the user is admin or staff via Supabase RPC.
 */
async function verifyAdminOrStaff(
  supabaseUrl: string,
  supabaseAnonKey: string,
  token: string,
): Promise<{ ok: true; userId: string } | { ok: false; error: string; status: number }> {
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return { ok: false, error: "Not authenticated", status: 401 };
  }

  const { data: isAdminOrStaff, error: roleError } = await supabase.rpc("is_admin_or_staff");
  if (roleError || !isAdminOrStaff) {
    return { ok: false, error: "Insufficient permissions — admin or staff required", status: 403 };
  }

  return { ok: true, userId: user.id };
}

/**
 * List all knowledge base IDs from Ragnarok.
 */
async function handleList(
  ragnarokUrl: string,
  ragnarokApiKey: string,
  projectId: string,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string; status: number }> {
  const url = new URL(`${ragnarokUrl}/knowledge_base/`);
  url.searchParams.set('project_id', projectId);

  const response = await fetch(url.toString(), {
    headers: { "Authorization": ragnarokApiKey },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    return { ok: false, error: `Ragnarok list failed: ${response.status}`, status: 502 };
  }

  const data = await response.json();
  return { ok: true, data };
}

/**
 * Delete a knowledge base from Ragnarok.
 */
async function handleDelete(
  ragnarokUrl: string,
  ragnarokApiKey: string,
  kbId: string,
  projectId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const url = new URL(`${ragnarokUrl}/knowledge_base/${encodeURIComponent(kbId)}/`);
  url.searchParams.set('project_id', projectId);

  const response = await fetch(url.toString(), {
    method: "DELETE",
    headers: { "Authorization": ragnarokApiKey },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    return { ok: false, error: `Ragnarok delete failed: ${response.status}`, status: 502 };
  }

  return { ok: true };
}

/**
 * Upload a file to Ragnarok knowledge base.
 * Forwards the file as multipart/form-data.
 */
async function handleUpload(
  ragnarokUrl: string,
  ragnarokApiKey: string,
  file: File,
  params: {
    kb_id?: string;
    project_id: string;
    language?: string;
    source_type?: string;
    enable_highlights?: boolean;
  },
): Promise<{ ok: true; data: unknown } | { ok: false; error: string; status: number }> {
  const formData = new FormData();
  formData.append("file", file);

  const url = new URL(`${ragnarokUrl}/knowledge_base/file`);
  url.searchParams.set("project_id", params.project_id);

  if (params.kb_id) url.searchParams.set("kb_id", params.kb_id);
  if (params.language) url.searchParams.set("language", params.language);
  if (params.source_type) url.searchParams.set("source_type", params.source_type);
  if (params.enable_highlights) url.searchParams.set("enable_highlights", "true");

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Authorization": ragnarokApiKey },
    body: formData,
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "(empty)");
    console.error(`Ragnarok upload error ${response.status}: ${errorText.slice(0, 500)}`);
    return { ok: false, error: `Ragnarok upload failed: ${response.status}`, status: 502 };
  }

  const data = await response.json();
  return { ok: true, data };
}

serve(async (req: Request) => {
  // --- CORS ---
  const origin = req.headers.get("Origin");
  const corsFailure = corsGuard({ origin, allowedOriginsRaw });
  if (corsFailure) return silentCorsDenyResponse();

  if (req.method === "OPTIONS") {
    return preflightResponse(req, allowedOriginsRaw, { allowMethods: "POST, OPTIONS" });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  // --- Auth ---
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse(req, { error: "Server not configured" }, 500);
  }

  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return jsonResponse(req, { error: "Not authenticated" }, 401);
  }

  const isServiceRole = token === serviceRoleKey;

  let userId = "service_role";
  if (!isServiceRole) {
    const authResult = await verifyAdminOrStaff(supabaseUrl, supabaseAnonKey, token);
    if (!authResult.ok) {
      return jsonResponse(req, { error: authResult.error }, authResult.status);
    }
    userId = authResult.userId;
  }

  // --- Ragnarok config ---
  // Local dev: fallback to local defaults when env vars not injected
  const ragnarokUrl = Deno.env.get("RAGNAROK_URL") ?? "http://host.docker.internal:9696";
  const ragnarokApiKey = Deno.env.get("RAGNAROK_API_KEY") ?? "evymo-ragnarok-local";

  // --- Determine action from content type ---
  const contentType = req.headers.get("Content-Type") ?? "";

  // Multipart = file upload
  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return jsonResponse(req, { error: "file is required in form data" }, 400);
    }

    const projectId = (formData.get("project_id") as string) ?? DEFAULT_PROJECT_ID;
    const kbId = formData.get("kb_id") as string | null;
    const language = formData.get("language") as string | null;
    const sourceType = formData.get("source_type") as string | null;
    const enableHighlights = formData.get("enable_highlights") === "true";

    const result = await handleUpload(ragnarokUrl, ragnarokApiKey, file, {
      kb_id: kbId ?? undefined,
      project_id: projectId,
      language: language ?? undefined,
      source_type: sourceType ?? undefined,
      enable_highlights: enableHighlights,
    });

    if (!result.ok) {
      return jsonResponse(req, { error: result.error }, result.status);
    }

    // Audit log: KB upload
    const auditClient = createClient(supabaseUrl, serviceRoleKey);
    await auditClient.from("audit_journal").insert({
      user_id: userId,
      action: "RAGNAROK_KB_UPLOAD",
      metadata: {
        area: "admin",
        severity: "info",
        project_id: projectId,
        kb_id: kbId ?? null,
        file_name: file.name,
      },
    });

    return jsonResponse(req, { ok: true, data: result.data }, 201);
  }

  // JSON = list or delete action
  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return jsonResponse(req, { error: "Invalid JSON body" }, 400);
  }

  const action = body.action;
  const projectId = typeof body.project_id === "string" ? body.project_id : DEFAULT_PROJECT_ID;

  if (action === "list") {
    const result = await handleList(ragnarokUrl, ragnarokApiKey, projectId);
    if (!result.ok) return jsonResponse(req, { error: result.error }, result.status);
    return jsonResponse(req, { ok: true, data: result.data });
  }

  if (action === "delete") {
    const kbId = body.kb_id;
    if (typeof kbId !== "string" || kbId.length === 0) {
      return jsonResponse(req, { error: "kb_id is required for delete action" }, 400);
    }
    const result = await handleDelete(ragnarokUrl, ragnarokApiKey, kbId, projectId);
    if (!result.ok) return jsonResponse(req, { error: result.error }, result.status);

    // Audit log: KB delete
    const auditClient = createClient(supabaseUrl, serviceRoleKey);
    await auditClient.from("audit_journal").insert({
      user_id: userId,
      action: "RAGNAROK_KB_DELETE",
      metadata: {
        area: "admin",
        severity: "warning",
        project_id: projectId,
        kb_id: kbId,
      },
    });

    return jsonResponse(req, { ok: true, deleted: kbId });
  }

  return jsonResponse(req, { error: "Unknown action. Use multipart upload or JSON with action: list|delete" }, 400);
});
