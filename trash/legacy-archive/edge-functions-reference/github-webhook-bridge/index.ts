/**
 * Edge Function: github-webhook-bridge
 *
 * Receives GitHub App webhooks, verifies HMAC-SHA256 signature,
 * handles installation lifecycle events, provides idempotency via
 * integration_events store, and forwards to n8n with enriched context.
 *
 * GitHub App → Supabase Edge → integration_events (idempotency) →
 *   installation lifecycle (DB) + n8n (aisha.id3a.cz)
 *
 * Routing:
 *   - installation (created/deleted/suspend/unsuspend) → DB only (no n8n)
 *   - installation_repositories (added/removed)        → DB only
 *   - pull_request (opened/synchronize/reopened)        → /webhook/pr-compliance-gate
 *   - push (main branch)                               → /webhook/push-deploy
 *   - issues / issue_comment                            → /webhook/issue-handler
 *   - check_suite / check_run                           → /webhook/check-status
 *   - workflow_run                                      → /webhook/workflow-status
 *   - *                                                 → /webhook/github-catchall
 *
 * Environment:
 *   - N8N_WEBHOOK_URL  (e.g. https://aisha.id3a.cz)
 *   - GITHUB_WEBHOOK_SECRET (shared secret from GitHub App)
 *   - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *
 * @module
 */

import { serve, createClient } from "../_shared/deps.ts";
import type { SupabaseClient } from "../_shared/deps.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WebhookPayload {
  action?: string;
  installation?: {
    id: number;
    account: { login: string; type: string };
    permissions?: Record<string, string>;
    repository_selection?: string;
  };
  repositories_added?: Array<{ id: number; full_name: string; private: boolean; default_branch?: string }>;
  repositories_removed?: Array<{ id: number; full_name: string }>;
  repository?: { full_name: string; default_branch?: string };
  sender?: { login: string };
}

interface EnrichmentContext {
  story_id: string | null;
  partner_id: string | null;
  installation_id: number | null;
}

// ---------------------------------------------------------------------------
// Supabase client (lazy singleton per isolate)
// ---------------------------------------------------------------------------

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;
  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("API_EXTERNAL_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  _supabase = createClient(url, key);
  return _supabase;
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/** Verify GitHub webhook HMAC-SHA256 signature (timing-safe). */
async function verifyGitHubSignature(
  payload: string,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!signature) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const digest = `sha256=${Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("")}`;

  // timing-safe comparison
  if (digest.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < digest.length; i++) {
    mismatch |= digest.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

// ---------------------------------------------------------------------------
// Installation lifecycle handlers
// ---------------------------------------------------------------------------

/** Handle installation.created — register new GitHub App installation */
async function handleInstallationCreated(body: WebhookPayload): Promise<void> {
  const inst = body.installation;
  if (!inst) return;

  const supabase = getSupabase();

  // Upsert installation record
  const { error } = await supabase.rpc("raw_query_admin", {
    p_params: [
      inst.id,
      inst.account.login,
      inst.account.type,
      JSON.stringify(inst.permissions ?? {}),
      inst.repository_selection ?? "selected",
    ],
    p_sql: `
      INSERT INTO github_app_installations (installation_id, account_login, account_type, permissions, repository_selection)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (installation_id) DO UPDATE SET
        account_login = EXCLUDED.account_login,
        permissions = EXCLUDED.permissions,
        repository_selection = EXCLUDED.repository_selection,
        suspended_at = NULL,
        updated_at = now()
    `,
  });

  if (error) {
    // Fallback: direct insert via service_role
    await supabase.from("github_app_installations").upsert({
      installation_id: inst.id,
      account_login: inst.account.login,
      account_type: inst.account.type,
      permissions: inst.permissions ?? {},
      repository_selection: inst.repository_selection ?? "selected",
      suspended_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "installation_id" });
  }

  // Sync initial repos if provided
  if (body.repositories_added?.length) {
    await syncRepositories(inst.id, body.repositories_added, []);
  }

  // Audit journal
  await supabase.rpc("write_audit_journal", {
    p_action_type: "integration",
    p_area: "system",
    p_details: {
      installation_id: inst.id,
      account_login: inst.account.login,
      account_type: inst.account.type,
    },
    p_entity_type: "github_app",
    p_severity: "info",
    p_summary: "GITHUB_APP_INSTALLED",
    p_user_id: null,
  });

  console.log(`[webhook-bridge] Installation created: ${inst.account.login} (${inst.id})`);
}

/** Handle installation.deleted or installation.suspend */
async function handleInstallationRemoved(body: WebhookPayload, isSuspend: boolean): Promise<void> {
  const inst = body.installation;
  if (!inst) return;

  const supabase = getSupabase();

  await supabase
    .from("github_app_installations")
    .update({ suspended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("installation_id", inst.id);

  await supabase.rpc("write_audit_journal", {
    p_action_type: "integration",
    p_area: "system",
    p_details: {
      installation_id: inst.id,
      account_login: inst.account.login,
    },
    p_entity_type: "github_app",
    p_severity: "warning",
    p_summary: isSuspend ? "GITHUB_APP_SUSPENDED" : "GITHUB_APP_UNINSTALLED",
    p_user_id: null,
  });

  console.log(`[webhook-bridge] Installation ${isSuspend ? "suspended" : "deleted"}: ${inst.account.login} (${inst.id})`);
}

/** Handle installation.unsuspend */
async function handleInstallationUnsuspend(body: WebhookPayload): Promise<void> {
  const inst = body.installation;
  if (!inst) return;

  const supabase = getSupabase();

  await supabase
    .from("github_app_installations")
    .update({ suspended_at: null, updated_at: new Date().toISOString() })
    .eq("installation_id", inst.id);

  console.log(`[webhook-bridge] Installation unsuspended: ${inst.account.login} (${inst.id})`);
}

/** Sync repositories added/removed from installation */
async function syncRepositories(
  installationId: number,
  added: Array<{ id: number; full_name: string; private: boolean; default_branch?: string }>,
  removed: Array<{ id: number; full_name: string }>,
): Promise<void> {
  const supabase = getSupabase();

  // Add new repos
  if (added.length > 0) {
    const rows = added.map((repo) => ({
      installation_id: installationId,
      repo_id: repo.id,
      repo_full_name: repo.full_name,
      is_private: repo.private ?? true,
      default_branch: repo.default_branch ?? "main",
      is_active: true,
      updated_at: new Date().toISOString(),
    }));

    await supabase
      .from("github_app_repositories")
      .upsert(rows, { onConflict: "installation_id,repo_id" });
  }

  // Mark removed repos as inactive
  if (removed.length > 0) {
    const repoIds = removed.map((r) => r.id);
    await supabase
      .from("github_app_repositories")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("installation_id", installationId)
      .in("repo_id", repoIds);
  }
}

// ---------------------------------------------------------------------------
// Event routing
// ---------------------------------------------------------------------------

/** Map GitHub event + action to n8n webhook path. */
function resolveWebhookPath(event: string, action: string | undefined): string | null {
  switch (event) {
    case "pull_request":
      if (action === "opened" || action === "synchronize" || action === "reopened") {
        return "/webhook/pr-compliance-gate";
      }
      return null; // ignore other PR actions

    case "push":
      return "/webhook/push-deploy";

    case "issues":
    case "issue_comment":
      return "/webhook/issue-handler";

    case "check_suite":
    case "check_run":
      return "/webhook/check-status";

    case "workflow_run":
      return "/webhook/workflow-status";

    default:
      return "/webhook/github-catchall";
  }
}

// ---------------------------------------------------------------------------
// Context enrichment
// ---------------------------------------------------------------------------

/** Resolve story_id, partner_id from webhook payload */
async function enrichContext(body: WebhookPayload): Promise<EnrichmentContext> {
  const installationId = body.installation?.id ?? null;
  const repoFullName = body.repository?.full_name;

  if (!repoFullName) {
    return { story_id: null, partner_id: null, installation_id: installationId };
  }

  try {
    const supabase = getSupabase();
    const { data } = await supabase.rpc("resolve_story_from_repo", {
      p_repo_full_name: repoFullName,
    });

    if (data && typeof data === "object" && "story_id" in (data as Record<string, unknown>)) {
      const d = data as Record<string, unknown>;
      return {
        story_id: (d.story_id as string) ?? null,
        partner_id: (d.partner_id as string) ?? null,
        installation_id: (d.installation_id as number) ?? installationId,
      };
    }
  } catch (err) {
    console.warn(`[webhook-bridge] Context enrichment failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { story_id: null, partner_id: null, installation_id: installationId };
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

interface IdempotencyResult {
  event_id: string;
  is_duplicate: boolean;
  status: string;
}

/** Record event in integration_events — returns null if duplicate */
async function recordEvent(
  delivery: string,
  eventType: string,
  context: EnrichmentContext,
  webhookPath: string | null,
): Promise<IdempotencyResult | null> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("record_integration_event", {
      p_event_source: "github_webhook",
      p_event_type: eventType,
      p_external_id: delivery,
      p_installation_id: context.installation_id,
      p_partner_id: context.partner_id,
      p_routed_to: webhookPath,
      p_story_id: context.story_id,
    });

    if (error) {
      console.warn(`[webhook-bridge] Failed to record event: ${error.message}`);
      return null; // Proceed without idempotency on DB failure
    }

    return data as IdempotencyResult;
  } catch (err) {
    console.warn(`[webhook-bridge] Event recording error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Update event status after n8n forwarding */
async function completeEvent(
  eventId: string,
  status: "completed" | "failed",
  n8nExecutionId?: string,
  errorJson?: Record<string, unknown>,
): Promise<void> {
  try {
    const supabase = getSupabase();
    await supabase.rpc("complete_integration_event", {
      p_error_json: errorJson ? JSON.stringify(errorJson) : null,
      p_event_id: eventId,
      p_n8n_execution_id: n8nExecutionId ?? null,
      p_status: status,
    });
  } catch (err) {
    console.warn(`[webhook-bridge] Failed to complete event: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Hub-Signature-256, X-GitHub-Event, X-GitHub-Delivery",
      },
    });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  // Read env
  const n8nBaseUrl = Deno.env.get("N8N_WEBHOOK_URL");
  const webhookSecret = Deno.env.get("GITHUB_WEBHOOK_SECRET");

  if (!n8nBaseUrl) {
    console.error("N8N_WEBHOOK_URL not configured");
    return errorResponse("Server misconfiguration", 500);
  }

  // Read event metadata
  const event = req.headers.get("X-GitHub-Event") ?? "unknown";
  const delivery = req.headers.get("X-GitHub-Delivery") ?? crypto.randomUUID();
  const signature = req.headers.get("X-Hub-Signature-256");

  // Read raw body for signature verification
  const rawBody = await req.text();

  // Verify signature
  if (webhookSecret) {
    const valid = await verifyGitHubSignature(rawBody, signature, webhookSecret);
    if (!valid) {
      console.warn(`[webhook-bridge] Invalid signature for delivery=${delivery} event=${event}`);
      return errorResponse("Invalid signature", 401);
    }
  } else {
    console.warn("[webhook-bridge] GITHUB_WEBHOOK_SECRET not set — skipping signature verification");
  }

  // Parse body
  let body: WebhookPayload;
  try {
    body = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const action = body.action;
  const eventType = action ? `${event}.${action}` : event;

  // -------------------------------------------------------------------------
  // Installation lifecycle events (DB only, no n8n forwarding)
  // -------------------------------------------------------------------------
  if (event === "installation") {
    switch (action) {
      case "created":
        await handleInstallationCreated(body);
        return jsonResponse({ ok: true, event: eventType, delivery, handled: "installation_created" });
      case "deleted":
        await handleInstallationRemoved(body, false);
        return jsonResponse({ ok: true, event: eventType, delivery, handled: "installation_deleted" });
      case "suspend":
        await handleInstallationRemoved(body, true);
        return jsonResponse({ ok: true, event: eventType, delivery, handled: "installation_suspended" });
      case "unsuspend":
        await handleInstallationUnsuspend(body);
        return jsonResponse({ ok: true, event: eventType, delivery, handled: "installation_unsuspended" });
    }
  }

  if (event === "installation_repositories") {
    const installationId = body.installation?.id;
    if (installationId) {
      await syncRepositories(
        installationId,
        body.repositories_added ?? [],
        body.repositories_removed ?? [],
      );
    }
    return jsonResponse({ ok: true, event: eventType, delivery, handled: "repos_synced" });
  }

  // -------------------------------------------------------------------------
  // Standard event routing (with idempotency + enrichment)
  // -------------------------------------------------------------------------

  // Resolve n8n webhook path
  const webhookPath = resolveWebhookPath(event, action);
  if (!webhookPath) {
    console.log(`[webhook-bridge] Ignoring event=${eventType} delivery=${delivery}`);
    return jsonResponse({ ok: true, ignored: true, event: eventType });
  }

  // Enrich context (story_id, partner_id)
  const context = await enrichContext(body);

  // Idempotency check
  const eventRecord = await recordEvent(delivery, eventType, context, webhookPath);
  if (eventRecord?.is_duplicate) {
    console.log(`[webhook-bridge] Duplicate delivery=${delivery} — skipping`);
    return jsonResponse({ ok: true, duplicate: true, event: eventType, delivery });
  }

  // Forward to n8n with enriched payload
  const targetUrl = `${n8nBaseUrl.replace(/\/$/, "")}${webhookPath}`;
  console.log(`[webhook-bridge] Forwarding event=${eventType} delivery=${delivery} → ${targetUrl}`);

  try {
    const enrichedPayload = JSON.stringify({
      ...body,
      _evymo: {
        delivery,
        event_type: eventType,
        story_id: context.story_id,
        partner_id: context.partner_id,
        installation_id: context.installation_id,
        event_id: eventRecord?.event_id ?? null,
      },
    });

    const n8nResponse = await fetch(targetUrl, {
      signal: AbortSignal.timeout(30_000),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": event,
        "X-GitHub-Delivery": delivery,
        "X-Forwarded-By": "evymo-webhook-bridge",
      },
      body: enrichedPayload,
    });

    const n8nStatus = n8nResponse.status;
    let n8nBody: string;
    try {
      n8nBody = await n8nResponse.text();
    } catch (readErr) {
      console.warn("Failed to read n8n response body:", readErr);
      n8nBody = "(empty)";
    }

    // Extract n8n execution ID from response if available
    let executionId: string | undefined;
    try {
      const parsed = JSON.parse(n8nBody) as Record<string, unknown>;
      executionId = (parsed.executionId as string) ?? undefined;
    } catch {
      // not JSON or no executionId — intentional silent parse
    }

    if (n8nStatus >= 400) {
      console.error(`[webhook-bridge] n8n returned ${n8nStatus}: ${n8nBody.substring(0, 200)}`);
      if (eventRecord?.event_id) {
        await completeEvent(eventRecord.event_id, "failed", executionId, {
          message: `n8n returned ${n8nStatus}`,
          n8n_status: n8nStatus,
          n8n_body: n8nBody.substring(0, 500),
        });
      }
    } else {
      if (eventRecord?.event_id) {
        await completeEvent(eventRecord.event_id, "completed", executionId);
      }
    }

    return jsonResponse({
      ok: n8nStatus < 400,
      event: eventType,
      delivery,
      n8n_status: n8nStatus,
      webhook_path: webhookPath,
      story_id: context.story_id,
      event_id: eventRecord?.event_id ?? null,
    }, n8nStatus < 400 ? 200 : 502);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[webhook-bridge] Failed to reach n8n: ${message}`);

    if (eventRecord?.event_id) {
      await completeEvent(eventRecord.event_id, "failed", undefined, {
        message: `n8n unreachable: ${message}`,
      });
    }

    return errorResponse(`n8n unreachable: ${message}`, 502);
  }
});
