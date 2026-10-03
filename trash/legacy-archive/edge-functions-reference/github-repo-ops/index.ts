/**
 * Edge Function: github-repo-ops
 *
 * Central service for GitHub API operations via AISHA Dirigent.
 * All operations go through GitHub App installation tokens obtained
 * from the github-app-auth edge function.
 *
 * Supported operations:
 *   - create_repo          — Create a new repository (org-scoped)
 *   - get_repo             — Get repo metadata
 *   - get_contents         — Read file/directory from repo
 *   - create_branch        — Create branch from ref
 *   - commit_file          — Create/update a single file
 *   - create_pr            — Open a pull request
 *   - merge_pr             — Merge a pull request
 *   - create_issue         — Create an issue
 *   - create_check_run     — Create a check run (CI status)
 *   - dispatch_workflow     — Trigger a GitHub Actions workflow
 *   - list_branches        — List branches in a repo
 *   - get_pull_request     — Get PR details
 *   - compare_commits      — Compare two refs
 *
 * Auth: service_role or valid Supabase JWT (checked against installation ownership)
 *
 * @module
 */

import { serve, createClient } from "../_shared/deps.ts";
import { preflightResponse } from "../_shared/cors.ts";
import type { SupabaseClient } from "../_shared/deps.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OperationRequest {
  operation: string;
  installation_id: number;
  params: Record<string, unknown>;
}

interface GitHubApiOptions {
  method: string;
  path: string;
  body?: Record<string, unknown>;
  accept?: string;
}

// ---------------------------------------------------------------------------
// Supabase client (lazy singleton)
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
// Installation token helper (calls github-app-auth edge function)
// ---------------------------------------------------------------------------

async function getInstallationToken(installationId: number): Promise<string> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("API_EXTERNAL_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/github-app-auth`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ installation_id: installationId }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Failed to get installation token: ${response.status} — ${errBody}`);
  }

  const data = await response.json() as { token: string };
  return data.token;
}

// ---------------------------------------------------------------------------
// GitHub API caller
// ---------------------------------------------------------------------------

const GITHUB_API = "https://api.github.com";

async function githubApi(
  token: string,
  options: GitHubApiOptions,
): Promise<{ status: number; data: unknown }> {
  const url = `${GITHUB_API}${options.path}`;

  if (!url.startsWith("https://")) {
    throw new Error(`Unsafe URL target: ${url}`);
  }

  const headers: Record<string, string> = {
    "Authorization": `token ${token}`,
    "Accept": options.accept ?? "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method: options.method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  const status = response.status;

  if (status === 204) {
    return { status, data: null };
  }

  let data: unknown;
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (status >= 400) {
    throw new GitHubApiError(status, data);
  }

  return { status, data };
}

class GitHubApiError extends Error {
  status: number;
  responseData: unknown;

  constructor(status: number, data: unknown) {
    const message = typeof data === "object" && data !== null && "message" in (data as Record<string, unknown>)
      ? (data as Record<string, string>).message
      : `GitHub API error (${status})`;
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
    this.responseData = data;
  }
}

// ---------------------------------------------------------------------------
// Operation handlers
// ---------------------------------------------------------------------------

type OperationHandler = (token: string, params: Record<string, unknown>) => Promise<{ status: number; data: unknown }>;

/** Create a new repository in an organization */
const createRepo: OperationHandler = (token, params) => {
  const org = params.org as string;
  const name = params.name as string;
  if (!org || !name) throw new Error("Missing required params: org, name");

  return githubApi(token, {
    method: "POST",
    path: `/orgs/${encodeURIComponent(org)}/repos`,
    body: {
      name,
      description: (params.description as string) ?? "",
      private: params.private !== false,
      auto_init: params.auto_init !== false,
      default_branch: (params.default_branch as string) ?? "main",
    },
  });
};

/** Get repository metadata */
const getRepo: OperationHandler = (token, params) => {
  const owner = params.owner as string;
  const repo = params.repo as string;
  if (!owner || !repo) throw new Error("Missing required params: owner, repo");

  return githubApi(token, {
    method: "GET",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
  });
};

/** Get file or directory contents */
const getContents: OperationHandler = (token, params) => {
  const owner = params.owner as string;
  const repo = params.repo as string;
  const path = (params.path as string) ?? "";
  if (!owner || !repo) throw new Error("Missing required params: owner, repo");

  const ref = params.ref as string | undefined;
  const queryString = ref ? `?ref=${encodeURIComponent(ref)}` : "";

  return githubApi(token, {
    method: "GET",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}${queryString}`,
  });
};

/** Create a new branch from a ref */
const createBranch: OperationHandler = async (token, params) => {
  const owner = params.owner as string;
  const repo = params.repo as string;
  const branch = params.branch as string;
  const fromRef = (params.from_ref as string) ?? "main";
  if (!owner || !repo || !branch) throw new Error("Missing required params: owner, repo, branch");

  // Get SHA of the source ref
  const { data: refData } = await githubApi(token, {
    method: "GET",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(fromRef)}`,
  });

  const sha = ((refData as Record<string, unknown>).object as Record<string, string>).sha;

  return githubApi(token, {
    method: "POST",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`,
    body: {
      ref: `refs/heads/${branch}`,
      sha,
    },
  });
};

/** Create or update a file (single file commit) */
const commitFile: OperationHandler = async (token, params) => {
  const owner = params.owner as string;
  const repo = params.repo as string;
  const path = params.path as string;
  const content = params.content as string;
  const message = params.message as string;
  const branch = (params.branch as string) ?? "main";
  if (!owner || !repo || !path || content === undefined || !message) {
    throw new Error("Missing required params: owner, repo, path, content, message");
  }

  // Encode content to base64
  const contentB64 = btoa(unescape(encodeURIComponent(content)));

  // Check if file exists (to get current SHA for update)
  let sha: string | undefined;
  try {
    const { data: existing } = await githubApi(token, {
      method: "GET",
      path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    });
    sha = (existing as Record<string, string>).sha;
  } catch (err) {
    if (err instanceof GitHubApiError && err.status === 404) {
      // File doesn't exist — create new
    } else {
      throw err;
    }
  }

  const body: Record<string, unknown> = {
    message,
    content: contentB64,
    branch,
  };
  if (sha) body.sha = sha;

  return githubApi(token, {
    method: "PUT",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`,
    body,
  });
};

/** Create a pull request */
const createPr: OperationHandler = (token, params) => {
  const owner = params.owner as string;
  const repo = params.repo as string;
  const title = params.title as string;
  const head = params.head as string;
  const base = (params.base as string) ?? "main";
  if (!owner || !repo || !title || !head) {
    throw new Error("Missing required params: owner, repo, title, head");
  }

  return githubApi(token, {
    method: "POST",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
    body: {
      title,
      head,
      base,
      body: (params.body as string) ?? "",
      draft: params.draft === true,
    },
  });
};

/** Merge a pull request */
const mergePr: OperationHandler = (token, params) => {
  const owner = params.owner as string;
  const repo = params.repo as string;
  const pullNumber = params.pull_number as number;
  if (!owner || !repo || !pullNumber) {
    throw new Error("Missing required params: owner, repo, pull_number");
  }

  return githubApi(token, {
    method: "PUT",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/merge`,
    body: {
      merge_method: (params.merge_method as string) ?? "squash",
      commit_title: (params.commit_title as string) ?? undefined,
      commit_message: (params.commit_message as string) ?? undefined,
    },
  });
};

/** Create an issue */
const createIssue: OperationHandler = (token, params) => {
  const owner = params.owner as string;
  const repo = params.repo as string;
  const title = params.title as string;
  if (!owner || !repo || !title) {
    throw new Error("Missing required params: owner, repo, title");
  }

  return githubApi(token, {
    method: "POST",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
    body: {
      title,
      body: (params.body as string) ?? "",
      labels: (params.labels as string[]) ?? [],
      assignees: (params.assignees as string[]) ?? [],
    },
  });
};

/** Create a check run (CI/CD status) */
const createCheckRun: OperationHandler = (token, params) => {
  const owner = params.owner as string;
  const repo = params.repo as string;
  const name = params.name as string;
  const headSha = params.head_sha as string;
  if (!owner || !repo || !name || !headSha) {
    throw new Error("Missing required params: owner, repo, name, head_sha");
  }

  return githubApi(token, {
    method: "POST",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/check-runs`,
    body: {
      name,
      head_sha: headSha,
      status: (params.status as string) ?? "queued",
      conclusion: (params.conclusion as string) ?? undefined,
      output: (params.output as Record<string, unknown>) ?? undefined,
      details_url: (params.details_url as string) ?? undefined,
    },
  });
};

/** Dispatch a GitHub Actions workflow */
const dispatchWorkflow: OperationHandler = (token, params) => {
  const owner = params.owner as string;
  const repo = params.repo as string;
  const workflowId = params.workflow_id as string | number;
  const ref = (params.ref as string) ?? "main";
  if (!owner || !repo || !workflowId) {
    throw new Error("Missing required params: owner, repo, workflow_id");
  }

  return githubApi(token, {
    method: "POST",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${workflowId}/dispatches`,
    body: {
      ref,
      inputs: (params.inputs as Record<string, string>) ?? {},
    },
  });
};

/** List branches */
const listBranches: OperationHandler = (token, params) => {
  const owner = params.owner as string;
  const repo = params.repo as string;
  if (!owner || !repo) throw new Error("Missing required params: owner, repo");

  const perPage = (params.per_page as number) ?? 30;
  const page = (params.page as number) ?? 1;

  return githubApi(token, {
    method: "GET",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=${perPage}&page=${page}`,
  });
};

/** Get pull request details */
const getPullRequest: OperationHandler = (token, params) => {
  const owner = params.owner as string;
  const repo = params.repo as string;
  const pullNumber = params.pull_number as number;
  if (!owner || !repo || !pullNumber) {
    throw new Error("Missing required params: owner, repo, pull_number");
  }

  return githubApi(token, {
    method: "GET",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}`,
  });
};

/** Compare two commits/branches/tags */
const compareCommits: OperationHandler = (token, params) => {
  const owner = params.owner as string;
  const repo = params.repo as string;
  const base = params.base as string;
  const head = params.head as string;
  if (!owner || !repo || !base || !head) {
    throw new Error("Missing required params: owner, repo, base, head");
  }

  return githubApi(token, {
    method: "GET",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
  });
};

// ---------------------------------------------------------------------------
// Operation registry
// ---------------------------------------------------------------------------

const operations: Record<string, OperationHandler> = {
  create_repo: createRepo,
  get_repo: getRepo,
  get_contents: getContents,
  create_branch: createBranch,
  commit_file: commitFile,
  create_pr: createPr,
  merge_pr: mergePr,
  create_issue: createIssue,
  create_check_run: createCheckRun,
  dispatch_workflow: dispatchWorkflow,
  list_branches: listBranches,
  get_pull_request: getPullRequest,
  compare_commits: compareCommits,
};

// ---------------------------------------------------------------------------
// Auth validation
// ---------------------------------------------------------------------------

function validateAuth(req: Request): boolean {
  const authHeader = req.headers.get("Authorization");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authHeader || !serviceKey) return false;

  const token = authHeader.replace(/^Bearer\s+/i, "");
  // Accept service_role key
  if (token === serviceKey) return true;

  // TODO: Accept valid Supabase JWT and verify installation ownership
  // For now, only service_role is allowed (edge functions + n8n)
  return false;
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function errorResponse(message: string, status: number, details?: unknown): Response {
  return new Response(JSON.stringify({ error: message, details }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return preflightResponse(req, Deno.env.get("ALLOWED_ORIGINS"));
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  // Auth check
  if (!validateAuth(req)) {
    return errorResponse("Unauthorized — service_role required", 401);
  }

  // Parse request
  let request: OperationRequest;
  try {
    request = await req.json() as OperationRequest;
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const { operation, installation_id, params } = request;

  // Validate request
  if (!operation || typeof operation !== "string") {
    return errorResponse("Missing 'operation' field", 400);
  }
  if (!installation_id || typeof installation_id !== "number") {
    return errorResponse("Missing or invalid 'installation_id' field", 400);
  }

  // Find handler
  const handler = operations[operation];
  if (!handler) {
    return errorResponse(
      `Unknown operation '${operation}'. Available: ${Object.keys(operations).join(", ")}`,
      400,
    );
  }

  // Get installation token
  let token: string;
  try {
    token = await getInstallationToken(installation_id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(`Token acquisition failed: ${msg}`, 502);
  }

  // Execute operation
  const startTime = Date.now();
  try {
    const result = await handler(token, params ?? {});
    const durationMs = Date.now() - startTime;

    // Record trace for observability
    try {
      const supabase = getSupabase();
      await supabase.rpc("write_audit_journal", {
        p_action_type: "integration",
        p_area: "system",
        p_details: {
          installation_id,
          operation,
          duration_ms: durationMs,
          github_status: result.status,
        },
        p_entity_type: "github_repo_ops",
        p_severity: "info",
        p_summary: `GITHUB_OP_${operation.toUpperCase()}`,
        p_user_id: null,
      });
    } catch (auditErr) {
      console.warn("Audit write failed (non-critical):", auditErr);
    }

    return jsonResponse({
      ok: true,
      operation,
      installation_id,
      github_status: result.status,
      data: result.data,
      duration_ms: durationMs,
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;

    if (err instanceof GitHubApiError) {
      // Audit failed operations too
      try {
        const supabase = getSupabase();
        await supabase.rpc("write_audit_journal", {
          p_action_type: "integration",
          p_area: "system",
          p_details: {
            installation_id,
            operation,
            duration_ms: durationMs,
            github_status: err.status,
          },
          p_entity_type: "github_repo_ops",
          p_severity: "warning",
          p_summary: `GITHUB_OP_${operation.toUpperCase()}_FAILED`,
          p_user_id: null,
        });
      } catch (auditErr) {
        console.warn("Audit write failed (non-critical):", auditErr);
      }

      return errorResponse(err.message, err.status >= 500 ? 502 : err.status, err.responseData);
    }

    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(msg, 500);
  }
});
