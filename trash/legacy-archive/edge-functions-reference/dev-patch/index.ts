/**
 * Edge Function: dev-patch
 *
 * Implements code changes for improvement proposals via the dev_patch agent.
 * Receives a proposal, generates a patch using LLM, and commits to Forgejo branch.
 *
 * Workflow:
 * 1. Load proposal + agent context (via compose_context)
 * 2. Generate patch via LLM (local MLX or cloud)
 * 3. Commit changes to Forgejo branch
 * 4. Return patch summary
 *
 * Called by WF_SELF_LEARNING_LOOP "Implement Change" node.
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
import { getDefaultModel } from "../_shared/defaultModel.ts";
import { safeError } from "../_shared/safeLogger.ts";

const allowedOriginsRaw = getAllowedOriginsRaw();

function jsonResponse(
  req: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return jsonResponseBase(req, allowedOriginsRaw, body, status);
}

// ============================================
// TYPES
// ============================================

interface DevPatchRequest {
  proposal_id: string;
  branch: string;
  category: string;
  title: string;
  description: string;
  current_value?: Record<string, unknown>;
  proposed_value?: Record<string, unknown>;
  story_id?: string;
}

interface PatchFile {
  path: string;
  content: string;
  action: "create" | "update";
}

interface LLMResponse {
  files: PatchFile[];
  commit_message: string;
  reasoning: string;
}

// ============================================
// LLM PATCH GENERATION
// ============================================

/**
 * Generate code patch via LLM (local MLX or cloud fallback).
 */
async function generatePatch(
  proposal: DevPatchRequest,
  contextPrompt: string,
): Promise<LLMResponse> {
  const localLlmUrl = Deno.env.get("LOCAL_LLM_URL") ?? "http://host.docker.internal:8100";
  const cloudLlmUrl = Deno.env.get("CLOUD_LLM_URL");
  const cloudLlmKey = Deno.env.get("CLOUD_LLM_API_KEY");
  const cloudLlmModel = Deno.env.get("CLOUD_LLM_MODEL") ?? getDefaultModel();

  const systemPrompt = `You are dev_patch, an autonomous code modification agent for the Evymo platform.

${contextPrompt}

Your task: Generate code changes for an improvement proposal.
Output ONLY valid JSON with this structure:
{
  "files": [{"path": "relative/path", "content": "full file content", "action": "create|update"}],
  "commit_message": "feat(scope): description",
  "reasoning": "brief explanation"
}

Rules:
- Follow all project coding standards from the context above
- Use RPC-only pattern for data access
- All UI text must use i18n t("key")
- No console.log — use safeError()
- No any types
- Include TSDoc on exports`;

  const userPrompt = `Implement this improvement proposal:

Title: ${proposal.title}
Category: ${proposal.category}
Description: ${proposal.description}
${proposal.current_value ? `Current config: ${JSON.stringify(proposal.current_value)}` : ""}
${proposal.proposed_value ? `Proposed config: ${JSON.stringify(proposal.proposed_value)}` : ""}

Generate the minimal code changes needed. Return valid JSON only.`;

  // Try local LLM first
  try {
    const localResponse = await fetch(`${localLlmUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "default",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 4096,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (localResponse.ok) {
      const data = await localResponse.json();
      const content = data.choices?.[0]?.message?.content;
      if (content) {
        return JSON.parse(content) as LLMResponse;
      }
    }
  } catch {
    // Local LLM unavailable, fall through to cloud
  }

  // Cloud fallback
  if (cloudLlmUrl && cloudLlmKey) {
    // SSRF validation: only allow HTTPS URLs for cloud LLM endpoints
    if (!cloudLlmUrl.startsWith("https://")) {
      throw new Error("CLOUD_LLM_URL must use HTTPS protocol");
    }

    const cloudResponse = await fetch(cloudLlmUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${cloudLlmKey}`,
      },
      body: JSON.stringify({
        model: cloudLlmModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 4096,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (cloudResponse.ok) {
      const data = await cloudResponse.json();
      const content = data.choices?.[0]?.message?.content;
      if (content) {
        return JSON.parse(content) as LLMResponse;
      }
    }
  }

  // No LLM available — return empty patch
  return {
    files: [],
    commit_message: `chore: placeholder for ${proposal.title}`,
    reasoning: "No LLM backend available for code generation",
  };
}

// ============================================
// FORGEJO GIT OPERATIONS
// ============================================

/**
 * Commit files to a Forgejo branch.
 */
async function commitToForgejo(
  branch: string,
  files: PatchFile[],
  commitMessage: string,
): Promise<{ sha: string; success: boolean }> {
  const forgejoUrl = Deno.env.get("FORGEJO_URL");
  const forgejoToken = Deno.env.get("FORGEJO_TOKEN");
  const forgejoRepo = Deno.env.get("FORGEJO_REPO") ?? "evymo/evymo-ai-orchestrator";

  if (!forgejoUrl || !forgejoToken) {
    return { sha: "", success: false };
  }

  // Commit each file via Forgejo Contents API
  let lastSha = "";
  for (const file of files) {
    const endpoint = `${forgejoUrl}/api/v1/repos/${forgejoRepo}/contents/${encodeURIComponent(file.path)}`;

    // Check if file exists to get its SHA
    let existingSha: string | undefined;
    try {
      const getResp = await fetch(`${endpoint}?ref=${encodeURIComponent(branch)}`, {
        headers: { "Authorization": `token ${forgejoToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (getResp.ok) {
        const existing = await getResp.json();
        existingSha = existing.sha;
      }
    } catch {
      // File doesn't exist yet
    }

    // Create or update file
    const body: Record<string, unknown> = {
      content: btoa(file.content), // Base64 encode
      message: commitMessage,
      branch: branch,
    };
    if (existingSha) {
      body.sha = existingSha;
    }

    const resp = await fetch(endpoint, {
      method: existingSha ? "PUT" : "POST",
      headers: {
        "Authorization": `token ${forgejoToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (resp.ok) {
      const result = await resp.json();
      lastSha = result.content?.sha ?? "";
    } else {
      safeError("dev-patch.forgejo.commit-failed", new Error(`HTTP ${resp.status} for ${file.path}`));
      return { sha: "", success: false };
    }
  }

  return { sha: lastSha, success: true };
}

// ============================================
// MAIN HANDLER
// ============================================

serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const corsFailure = corsGuard({ origin, allowedOriginsRaw });
  if (corsFailure) return silentCorsDenyResponse();

  if (req.method === "OPTIONS") {
    return preflightResponse(req, allowedOriginsRaw, { allowMethods: "POST, OPTIONS" });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  // Auth: service_role only (internal calls from n8n)
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (token !== serviceRoleKey) {
    return jsonResponse(req, { error: "Service role required" }, 403);
  }

  try {
    const body = (await req.json()) as DevPatchRequest;

    if (!body.proposal_id || !body.branch || !body.title) {
      return jsonResponse(req, { error: "proposal_id, branch, and title are required" }, 400);
    }

    // 1. Get agent context
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let contextPrompt = "";
    if (body.story_id) {
      const { data: contextData } = await supabase.rpc("compose_context", {
        p_context_profile_slug: "repo_plus_rules",
        p_query: body.description ?? body.title,
        p_run_id: null,
        p_story_id: body.story_id,
      });
      if (contextData?.compiled_system_prompt) {
        contextPrompt = contextData.compiled_system_prompt;
      }
    }

    // 2. Generate patch via LLM
    const patch = await generatePatch(body, contextPrompt);

    if (patch.files.length === 0) {
      return jsonResponse(req, {
        status: "no_changes",
        proposal_id: body.proposal_id,
        reasoning: patch.reasoning,
        files_modified: [],
      });
    }

    // 3. Commit to Forgejo
    const commitResult = await commitToForgejo(
      body.branch,
      patch.files,
      patch.commit_message,
    );

    // 4. Log trace
    await supabase.rpc("fn_log_ai_trace_event", {
      p_agent_slug: "dev_patch",
      p_duration_ms: 0,
      p_event_type: "patch_applied",
      p_operation: "implement_proposal",
      p_request_summary: {
        proposal_id: body.proposal_id,
        category: body.category,
        files_count: patch.files.length,
      },
      p_response_summary: {
        commit_sha: commitResult.sha,
        commit_message: patch.commit_message,
        files: patch.files.map((f) => f.path),
      },
      p_status: commitResult.success ? "success" : "error",
    });

    return jsonResponse(req, {
      status: commitResult.success ? "applied" : "commit_failed",
      proposal_id: body.proposal_id,
      commit_sha: commitResult.sha,
      commit_message: patch.commit_message,
      files_modified: patch.files.map((f) => ({ path: f.path, action: f.action })),
      reasoning: patch.reasoning,
    });
  } catch (err) {
    safeError("dev-patch.handler.failed", err);
    return jsonResponse(req, { error: "Patch generation failed" }, 500);
  }
});
