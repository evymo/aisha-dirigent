/**
 * Dev-patch — AI agent that generates code patches from improvement proposals.
 * Service-role only (called from n8n WF_SELF_LEARNING_LOOP).
 *
 * Flow: load context → LLM generates code → commit to Forgejo → audit trail.
 */
import type { FastifyBaseLogger, FastifyInstance, FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';

const POSTGREST = config.postgrestUrl;
const SERVICE_TOKEN = (process.env.POSTGREST_SERVICE_TOKEN ?? '');
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? '';

// ── Types ──

interface DevPatchRequest {
  branch: string;
  category: string;
  current_value?: Record<string, unknown>;
  description: string;
  proposal_id: string;
  proposed_value?: Record<string, unknown>;
  story_id?: string;
  title: string;
}

interface PatchFile {
  action: 'create' | 'update';
  content: string;
  path: string;
}

interface LLMResponse {
  commit_message: string;
  files: PatchFile[];
  reasoning: string;
}

// ── PostgREST RPC ──

async function rpc<T = unknown>(fn: string, params: Record<string, unknown>): Promise<T | null> {
  const resp = await fetch(`${POSTGREST}/rpc/${fn}`, {
    body: JSON.stringify(params),
    headers: {
      'Authorization': `Bearer ${SERVICE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) return null;
  return resp.json() as Promise<T>;
}

// ── LLM patch generation ──

async function generatePatch(proposal: DevPatchRequest, contextPrompt: string): Promise<LLMResponse> {
  const localLlmUrl = process.env.LOCAL_LLM_URL ?? 'http://host.docker.internal:8100';
  const cloudLlmUrl = process.env.CLOUD_LLM_URL;
  const cloudLlmKey = process.env.CLOUD_LLM_API_KEY;
  const cloudLlmModel = process.env.CLOUD_LLM_MODEL ?? 'gpt-4o';

  const systemPrompt = `You are dev_patch, an autonomous code modification agent for the AISHA platform.

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
${proposal.current_value ? `Current config: ${JSON.stringify(proposal.current_value)}` : ''}
${proposal.proposed_value ? `Proposed config: ${JSON.stringify(proposal.proposed_value)}` : ''}

Generate the minimal code changes needed. Return valid JSON only.`;

  const messages = [
    { content: systemPrompt, role: 'system' },
    { content: userPrompt, role: 'user' },
  ];

  // Try local LLM first
  try {
    const localResp = await fetch(`${localLlmUrl}/v1/chat/completions`, {
      body: JSON.stringify({ max_tokens: 4096, messages, model: 'default', temperature: 0.3 }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: AbortSignal.timeout(120_000),
    });

    if (localResp.ok) {
      const data = await localResp.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content;
      if (content) return JSON.parse(content) as LLMResponse;
    }
  } catch {
    // Local LLM unavailable, fall through to cloud
  }

  // Cloud fallback
  if (cloudLlmUrl && cloudLlmKey) {
    // SSRF validation: only allow HTTPS for cloud endpoints
    if (!cloudLlmUrl.startsWith('https://')) {
      throw new Error('CLOUD_LLM_URL must use HTTPS protocol');
    }

    const cloudResp = await fetch(cloudLlmUrl, {
      body: JSON.stringify({ max_tokens: 4096, messages, model: cloudLlmModel, response_format: { type: 'json_object' }, temperature: 0.3 }),
      headers: { 'Authorization': `Bearer ${cloudLlmKey}`, 'Content-Type': 'application/json' },
      method: 'POST',
      signal: AbortSignal.timeout(120_000),
    });

    if (cloudResp.ok) {
      const data = await cloudResp.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content;
      if (content) return JSON.parse(content) as LLMResponse;
    }
  }

  // No LLM available
  return { commit_message: `chore: placeholder for ${proposal.title}`, files: [], reasoning: 'No LLM backend available for code generation' };
}

// ── Forgejo git operations ──

async function commitToForgejo(branch: string, files: PatchFile[], commitMessage: string, logger: FastifyBaseLogger): Promise<{ sha: string; success: boolean }> {
  const forgejoUrl = process.env.FORGEJO_URL;
  const forgejoToken = process.env.FORGEJO_TOKEN;
  const forgejoRepo = process.env.FORGEJO_REPO ?? 'aisha/evymo-ai-orchestrator';

  if (!forgejoUrl || !forgejoToken) {
    return { sha: '', success: false };
  }

  let lastSha = '';
  for (const file of files) {
    const endpoint = `${forgejoUrl}/api/v1/repos/${forgejoRepo}/contents/${encodeURIComponent(file.path)}`;

    // Check if file exists to get its SHA
    let existingSha: string | undefined;
    try {
      const getResp = await fetch(`${endpoint}?ref=${encodeURIComponent(branch)}`, {
        headers: { 'Authorization': `token ${forgejoToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (getResp.ok) {
        const existing = await getResp.json() as { sha?: string };
        existingSha = existing.sha;
      }
    } catch {
      // File doesn't exist yet
    }

    const body: Record<string, unknown> = {
      branch,
      content: Buffer.from(file.content).toString('base64'),
      message: commitMessage,
    };
    if (existingSha) body.sha = existingSha;

    const resp = await fetch(endpoint, {
      body: JSON.stringify(body),
      headers: { 'Authorization': `token ${forgejoToken}`, 'Content-Type': 'application/json' },
      method: existingSha ? 'PUT' : 'POST',
      signal: AbortSignal.timeout(30_000),
    });

    if (resp.ok) {
      const result = await resp.json() as { content?: { sha?: string } };
      lastSha = result.content?.sha ?? '';
    } else {
      logger.error({ file: file.path, status: resp.status }, 'Forgejo commit failed');
      return { sha: '', success: false };
    }
  }

  return { sha: lastSha, success: true };
}

// ── Route ──

export const devPatchRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {

  app.post<{ Body: DevPatchRequest }>('/dev-patch', async (request, reply) => {
    // Auth: internal API key (called from n8n)
    const authHeader = request.headers.authorization ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!INTERNAL_API_KEY || token !== INTERNAL_API_KEY) {
      return reply.code(403).send({ error: 'Service role required' });
    }

    const { branch, category, current_value, description, proposal_id, proposed_value, story_id, title } = request.body;
    if (!proposal_id || !branch || !title) {
      return reply.code(400).send({ error: 'proposal_id, branch, and title are required' });
    }

    // 1. Get agent context
    let contextPrompt = '';
    if (story_id) {
      const contextData = await rpc<{ compiled_system_prompt?: string }>('compose_context', {
        p_context_profile_slug: 'repo_plus_rules',
        p_query: description ?? title,
        p_run_id: null,
        p_story_id: story_id,
      });
      if (contextData?.compiled_system_prompt) {
        contextPrompt = contextData.compiled_system_prompt;
      }
    }

    // 2. Generate patch via LLM
    const patch = await generatePatch(request.body, contextPrompt);

    if (patch.files.length === 0) {
      return reply.send({ files_modified: [], proposal_id, reasoning: patch.reasoning, status: 'no_changes' });
    }

    // 3. Commit to Forgejo
    const commitResult = await commitToForgejo(branch, patch.files, patch.commit_message, request.log);

    // 4. Log trace
    await rpc('fn_log_ai_trace_event', {
      p_agent_slug: 'dev_patch',
      p_duration_ms: 0,
      p_event_type: 'patch_applied',
      p_operation: 'implement_proposal',
      p_request_summary: { category, files_count: patch.files.length, proposal_id },
      p_response_summary: { commit_message: patch.commit_message, commit_sha: commitResult.sha, files: patch.files.map((f) => f.path) },
      p_status: commitResult.success ? 'success' : 'error',
    });

    return reply.send({
      commit_message: patch.commit_message,
      commit_sha: commitResult.sha,
      files_modified: patch.files.map((f) => ({ action: f.action, path: f.path })),
      proposal_id,
      reasoning: patch.reasoning,
      status: commitResult.success ? 'applied' : 'commit_failed',
    });
  });
};
