import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { verifyServiceRole } from '../auth.js';
import { getInstallationToken } from '../lib/github-jwt.js';
import { githubApi, GitHubApiError } from '../lib/github-api.js';
import { rpcService } from '../postgrest.js';

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const RepoOpsRequestSchema = z.object({
  /** Registered operation name (see operation registry below). */
  operation: z.string().min(1),
  /** GitHub App installation id used to acquire the installation token. */
  installation_id: z.number().int().positive(),
  /** Operation-specific parameters, forwarded to the handler. */
  params: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Operation types
// ---------------------------------------------------------------------------

type OperationHandler = (
  token: string,
  params: Record<string, unknown>,
) => Promise<{ status: number; data: unknown }>;

// ---------------------------------------------------------------------------
// 13 GitHub repo operations
// ---------------------------------------------------------------------------

const createRepo: OperationHandler = (token, params) => {
  const org = params.org as string;
  const name = params.name as string;
  if (!org || !name) throw new Error('Missing required params: org, name');
  return githubApi(token, {
    method: 'POST',
    path: `/orgs/${encodeURIComponent(org)}/repos`,
    body: {
      name,
      description: (params.description as string) ?? '',
      private: params.private !== false,
      auto_init: params.auto_init !== false,
      default_branch: (params.default_branch as string) ?? 'main',
    },
  });
};

const getRepo: OperationHandler = (token, params) => {
  const owner = params.owner as string;
  const repo = params.repo as string;
  if (!owner || !repo) throw new Error('Missing required params: owner, repo');
  return githubApi(token, { method: 'GET', path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` });
};

const getContents: OperationHandler = (token, params) => {
  const owner = params.owner as string;
  const repo = params.repo as string;
  const path = (params.path as string) ?? '';
  if (!owner || !repo) throw new Error('Missing required params: owner, repo');
  const ref = params.ref as string | undefined;
  const qs = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  return githubApi(token, {
    method: 'GET',
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}${qs}`,
  });
};

const createBranch: OperationHandler = async (token, params) => {
  const owner = params.owner as string;
  const repo = params.repo as string;
  const branch = params.branch as string;
  const fromRef = (params.from_ref as string) ?? 'main';
  if (!owner || !repo || !branch) throw new Error('Missing required params: owner, repo, branch');

  const { data: refData } = await githubApi(token, {
    method: 'GET',
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(fromRef)}`,
  });
  const sha = ((refData as Record<string, unknown>).object as Record<string, string>).sha;

  return githubApi(token, {
    method: 'POST',
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`,
    body: { ref: `refs/heads/${branch}`, sha },
  });
};

const commitFile: OperationHandler = async (token, params) => {
  const owner = params.owner as string;
  const repo = params.repo as string;
  const path = params.path as string;
  const content = params.content as string;
  const message = params.message as string;
  const branch = (params.branch as string) ?? 'main';
  if (!owner || !repo || !path || content === undefined || !message) {
    throw new Error('Missing required params: owner, repo, path, content, message');
  }

  const contentB64 = Buffer.from(content, 'utf-8').toString('base64');

  // Check if file exists for update SHA
  let sha: string | undefined;
  try {
    const { data: existing } = await githubApi(token, {
      method: 'GET',
      path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    });
    sha = (existing as Record<string, string>).sha;
  } catch (err) {
    if (err instanceof GitHubApiError && err.status === 404) {
      // new file
    } else {
      throw err;
    }
  }

  const body: Record<string, unknown> = { message, content: contentB64, branch };
  if (sha) body.sha = sha;

  return githubApi(token, {
    method: 'PUT',
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`,
    body,
  });
};

const createPr: OperationHandler = (token, params) => {
  const owner = params.owner as string;
  const repo = params.repo as string;
  const title = params.title as string;
  const head = params.head as string;
  const base = (params.base as string) ?? 'main';
  if (!owner || !repo || !title || !head) throw new Error('Missing required params: owner, repo, title, head');
  return githubApi(token, {
    method: 'POST',
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
    body: { title, head, base, body: (params.body as string) ?? '', draft: params.draft === true },
  });
};

const mergePr: OperationHandler = (token, params) => {
  const owner = params.owner as string;
  const repo = params.repo as string;
  const pullNumber = params.pull_number as number;
  if (!owner || !repo || !pullNumber) throw new Error('Missing required params: owner, repo, pull_number');
  return githubApi(token, {
    method: 'PUT',
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/merge`,
    body: {
      merge_method: (params.merge_method as string) ?? 'squash',
      commit_title: (params.commit_title as string) ?? undefined,
      commit_message: (params.commit_message as string) ?? undefined,
    },
  });
};

const createIssue: OperationHandler = (token, params) => {
  const owner = params.owner as string;
  const repo = params.repo as string;
  const title = params.title as string;
  if (!owner || !repo || !title) throw new Error('Missing required params: owner, repo, title');
  return githubApi(token, {
    method: 'POST',
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
    body: { title, body: (params.body as string) ?? '', labels: (params.labels as string[]) ?? [], assignees: (params.assignees as string[]) ?? [] },
  });
};

const createCheckRun: OperationHandler = (token, params) => {
  const owner = params.owner as string;
  const repo = params.repo as string;
  const name = params.name as string;
  const headSha = params.head_sha as string;
  if (!owner || !repo || !name || !headSha) throw new Error('Missing required params: owner, repo, name, head_sha');
  return githubApi(token, {
    method: 'POST',
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/check-runs`,
    body: {
      name, head_sha: headSha,
      status: (params.status as string) ?? 'queued',
      conclusion: (params.conclusion as string) ?? undefined,
      output: (params.output as Record<string, unknown>) ?? undefined,
      details_url: (params.details_url as string) ?? undefined,
    },
  });
};

const dispatchWorkflow: OperationHandler = (token, params) => {
  const owner = params.owner as string;
  const repo = params.repo as string;
  const workflowId = params.workflow_id as string | number;
  const ref = (params.ref as string) ?? 'main';
  if (!owner || !repo || !workflowId) throw new Error('Missing required params: owner, repo, workflow_id');
  return githubApi(token, {
    method: 'POST',
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${workflowId}/dispatches`,
    body: { ref, inputs: (params.inputs as Record<string, string>) ?? {} },
  });
};

const listBranches: OperationHandler = (token, params) => {
  const owner = params.owner as string;
  const repo = params.repo as string;
  if (!owner || !repo) throw new Error('Missing required params: owner, repo');
  const perPage = (params.per_page as number) ?? 30;
  const page = (params.page as number) ?? 1;
  return githubApi(token, {
    method: 'GET',
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=${perPage}&page=${page}`,
  });
};

const getPullRequest: OperationHandler = (token, params) => {
  const owner = params.owner as string;
  const repo = params.repo as string;
  const pullNumber = params.pull_number as number;
  if (!owner || !repo || !pullNumber) throw new Error('Missing required params: owner, repo, pull_number');
  return githubApi(token, {
    method: 'GET',
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}`,
  });
};

const compareCommits: OperationHandler = (token, params) => {
  const owner = params.owner as string;
  const repo = params.repo as string;
  const base = params.base as string;
  const head = params.head as string;
  if (!owner || !repo || !base || !head) throw new Error('Missing required params: owner, repo, base, head');
  return githubApi(token, {
    method: 'GET',
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
// Route
// ---------------------------------------------------------------------------

export async function repoOpsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/repo-ops', async (req: FastifyRequest, reply: FastifyReply) => {
    // Auth: service-role or KC JWT with admin/staff
    try {
      verifyServiceRole(req.headers.authorization);
    } catch {
      return reply.code(401).send({ error: 'Unauthorized — service_role required' });
    }

    const parseResult = RepoOpsRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      // Preserve the original field-specific error messages (operation checked first).
      const operationInvalid = parseResult.error.issues.some((i) => i.path[0] === 'operation');
      if (operationInvalid) {
        return reply.code(400).send({ error: "Missing 'operation' field" });
      }
      return reply.code(400).send({ error: "Missing or invalid 'installation_id' field" });
    }
    const { operation, installation_id, params } = parseResult.data;

    const handler = operations[operation];
    if (!handler) {
      return reply.code(400).send({
        error: `Unknown operation '${operation}'. Available: ${Object.keys(operations).join(', ')}`,
      });
    }

    const startTime = Date.now();
    let token: string;
    try {
      token = await getInstallationToken(installation_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: `Token acquisition failed: ${msg}` });
    }

    try {
      const result = await handler(token, params ?? {});
      const durationMs = Date.now() - startTime;

      // Audit trace
      try {
        await rpcService('write_audit_journal', {
          p_action_type: 'integration',
          p_area: 'system',
          p_details: { installation_id, operation, duration_ms: durationMs, github_status: result.status },
          p_entity_type: 'github_repo_ops',
          p_severity: 'info',
          p_summary: `GITHUB_OP_${operation.toUpperCase()}`,
          p_user_id: null,
        });
      } catch {
        // non-critical
      }

      return reply.send({
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
        try {
          await rpcService('write_audit_journal', {
            p_action_type: 'integration',
            p_area: 'system',
            p_details: { installation_id, operation, duration_ms: durationMs, github_status: err.status },
            p_entity_type: 'github_repo_ops',
            p_severity: 'warning',
            p_summary: `GITHUB_OP_${operation.toUpperCase()}_FAILED`,
            p_user_id: null,
          });
        } catch {
          // non-critical
        }
        return reply.code(err.status >= 500 ? 502 : err.status).send({
          error: err.message,
          details: err.responseData,
        });
      }

      const msg = err instanceof Error ? err.message : String(err);
      req.log.error({ err, operation, installation_id }, 'Repo operation failed');
      return reply.code(500).send({ error: msg });
    }
  });
}
