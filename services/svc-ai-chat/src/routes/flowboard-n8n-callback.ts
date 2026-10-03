/**
 * POST /flowboard-n8n-callback — n8n execution → per-node Flowboard run provenance.
 *
 * The n8n-engine workflow calls this back as it executes; each step becomes an
 * `automation_step` in the run's StoryLoop story — the SAME iconographic timeline as the
 * sandbox engine, just written from a service context. Auth: X-N8N-API-Key (constant-time,
 * like routes/callback.ts) OR service-role. Provenance is mapped by the shared
 * @aisha/flowboard-core buildStepEntry and persisted via the service-role writer
 * append_flowboard_run_entry_service (owner-attributed, idempotent by run_id+node_id).
 */
import type { FastifyInstance } from 'fastify';
import { constantTimeStringCompare } from '@aisha/security';
import { verifyServiceRole, AuthError } from '../auth.js';
import { rpcService } from '../postgrest.js';
import { config } from '../config.js';
import { buildStepEntry, type NodeRunStatus } from '@aisha/flowboard-core';
import { nodeKind } from '../lib/flowboardSandboxExecutor.js';

interface CallbackStep {
  node_id: string;
  type_id: string;
  status?: string;
  label?: string;
  output?: string;
}
interface CallbackBody {
  story_id: string;
  owner_id: string;
  graph_id: string;
  run_id: string;
  /** Explicit per-node steps (direct callers / tests). */
  steps?: CallbackStep[];
  /** OR an n8n execution id — the handler pulls the execution and derives the steps. */
  execution_id?: string;
}

/** Map an n8n node status onto the provenance status vocabulary. */
function mapStatus(s: string | undefined): NodeRunStatus {
  if (s === 'success' || s === 'ok') return 'ok';
  if (s === 'error' || s === 'failed') return 'error';
  return 'skipped';
}

export async function flowboardN8nCallbackRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CallbackBody }>('/flowboard-n8n-callback', async (req, reply) => {
    const n8nKey = req.headers['x-n8n-api-key'] as string | undefined;
    if (n8nKey) {
      if (!config.n8nApiKey || !constantTimeStringCompare(n8nKey, config.n8nApiKey)) {
        return reply.code(401).send({ error: 'Invalid n8n API key' });
      }
    } else {
      try {
        verifyServiceRole(req.headers.authorization ?? '');
      } catch (err) {
        return reply.code(err instanceof AuthError ? err.statusCode : 401).send({ error: 'Unauthorized' });
      }
    }

    const body = req.body;
    if (!body?.story_id || !body?.owner_id || !body?.run_id || (!Array.isArray(body?.steps) && !body?.execution_id)) {
      return reply.code(400).send({ error: 'story_id, owner_id, run_id and (steps[] or execution_id) are required' });
    }

    const steps: CallbackStep[] = Array.isArray(body.steps) ? [...body.steps] : [];

    // execution_id path: pull the finished n8n execution and map its per-node run data (keyed by
    // node NAME) back to flowboard node ids via the compiled workflow's meta.flowboardNodeMap.
    // Best-effort + n8n-version-specific (resultData.runData shape) — verified against a live n8n.
    if (body.execution_id && config.n8nBaseUrl && config.n8nApiKey) {
      try {
        const base = config.n8nBaseUrl.replace(/\/$/, '');
        const exRes = await fetch(`${base}/api/v1/executions/${body.execution_id}?includeData=true`, {
          headers: { 'X-N8N-API-Key': config.n8nApiKey },
          signal: AbortSignal.timeout(8000),
        });
        if (exRes.ok) {
          const ex = (await exRes.json()) as {
            workflowData?: { meta?: { flowboardNodeMap?: Record<string, { id: string; typeId: string }> } };
            data?: { resultData?: { runData?: Record<string, Array<{ error?: unknown }>> } };
          };
          const nodeMap = ex.workflowData?.meta?.flowboardNodeMap ?? {};
          const runData = ex.data?.resultData?.runData ?? {};
          for (const [nodeName, runs] of Object.entries(runData)) {
            const m = nodeMap[nodeName];
            if (!m) continue; // skip injected / non-flowboard nodes (router, callback)
            const failed = Array.isArray(runs) && runs.some((r) => r && r.error);
            steps.push({ node_id: m.id, type_id: m.typeId, status: failed ? 'error' : 'success' });
          }
        }
      } catch {
        /* best-effort: a failed execution pull must not block writing any explicit steps */
      }
    }

    let written = 0;
    for (const step of steps) {
      if (!step?.node_id || !step?.type_id) continue;
      const kind = nodeKind(step.type_id);
      const params = buildStepEntry(
        { storyId: body.story_id, runId: body.run_id, graphId: body.graph_id, graphName: '', engine: 'n8n' },
        {
          nodeId: step.node_id,
          typeId: step.type_id,
          kind,
          label: step.label ?? step.type_id,
          status: mapStatus(step.status),
          startedAt: new Date().toISOString(),
          summary: step.output,
        },
      );
      const { error } = await rpcService<{ entry_id?: string }>('append_flowboard_run_entry_service', {
        p_content: params.p_content,
        p_entry_type: params.p_entry_type,
        p_metadata: params.p_metadata,
        p_node_id: step.node_id,
        p_owner_id: body.owner_id,
        p_run_id: body.run_id,
        p_story_id: body.story_id,
      }).then((data) => ({ error: null, data })).catch((e) => ({ error: e, data: null }));
      if (!error) written += 1;
    }

    return reply.send({ ok: true, written, run_id: body.run_id });
  });
}
