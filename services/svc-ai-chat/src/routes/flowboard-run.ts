/**
 * POST /flowboard-execute { graph_id, story_id } — run a saved FlowGraph in the governed sandbox.
 *
 * Loads the authoritative stored graph (get_flowboard_graph, owner-scoped), then
 * runs it through flowboardSandboxExecutor under the USER's JWT so the consent /
 * compliance gates are ENFORCED (halt, not hint) and provenance lands in the
 * user's StoryLoop. A graph pinned to the n8n engine is validated FOR that engine
 * (gates are sandbox-only → fail-closed 422, never a noOp passthrough), compiled
 * (compileToN8n) and created+activated in n8n via ../lib/n8n-client (SSRF-guarded).
 *
 * The run is always scoped to a story (story_id in the body): create_story_entry_audited
 * asserts auth.uid() AND story access, so provenance can only be written into a story
 * the caller owns.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { verifyToken } from '../auth.js';
import { createUserRpcAdapter } from '../lib/rpcAdapter.js';
import { executeFlowGraph, type FlowGraph, type AgentDispatch, type ActionDispatch, type FlowRunContext } from '../lib/flowboardSandboxExecutor.js';
import {
  compileToN8n,
  flowGraphSchema,
  validateGraph,
  buildFlowRegistry,
  builtinProvider,
  agentCatalogProvider,
  buildFlowRunEntry,
  type AgentCatalogRow,
} from '@aisha/flowboard-core';
import { pushWorkflowToN8n, activateWorkflowInN8n, N8nEngineError } from '../lib/n8n-client.js';
import { unifiedChat, resolveAvailableModel } from '../lib/llmRouter.js';
import { journalDispatch } from '../lib/dispatchJournal.js';
import { resolveSlotModel } from '../reflection/soulforge.js';
import { withAitgGuardOrRefuse, createAitgRunner } from '@aisha/aitg';
import { config } from '../config.js';

// OWASP AITG output guard — classify each agent step's output (AITG-APP-01 injection
// bleed-through, AITG-APP-12 toxic output) BEFORE it becomes the flow-node result; a
// violation is replaced with a safe refusal. Fail-soft transport (the runner swallows
// the write error and returns null — never breaks the flow run).
const aitgRunner = createAitgRunner({
  postgrestUrl: config.postgrestUrl,
  serviceToken: config.postgrestServiceToken,
  service: 'svc-ai-chat:flowboard-run',
});

// A Flowboard agent's configured "model" is often a Soulforge quality PROFILE
// (budget/balanced/maxQuality), not a concrete model id — and resolveAvailableModel expects a real
// id (it does capability-availability remap, not slot resolution). So a profile is first mapped to
// a concrete model via the canonical slot matrix (honouring the requested quality tier) before remap.
const SLOT_PROFILES = new Set(['budget', 'balanced', 'maxQuality']);

// Agent-node executor: the run's agent steps go through the service's existing LLM router.
export const dispatchAgent: AgentDispatch = async ({ slug, model, prompt, storyId }) => {
  const modelId = SLOT_PROFILES.has(model) ? await resolveSlotModel('ember', model) : model;
  const resolved = resolveAvailableModel(modelId);
  // I1: every model-override dispatch is journaled (story-scoped) BEFORE the raw call — no
  // unjournaled LLM dispatch (the decision journal is the orchestration-authority backstop).
  await journalDispatch({ model: resolved.model, provider: resolved.provider, storyId, reason: `flowboard.agent:${slug}` });
  const result = await unifiedChat({
    provider: resolved.provider,
    model: resolved.model,
    maxTokens: 600,
    systemPrompt: `You are the "${slug}" agent executing one step of an AISHA automation flow. Be concise and produce only this step's output.`,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
  });
  // OWASP AITG output guard: classify the step output before it becomes the node
  // result; on violation the node receives a safe refusal instead of unsafe text.
  const guarded = await withAitgGuardOrRefuse(
    {
      runner: aitgRunner,
      buildSha: config.buildSha ?? 'dev',
      triggeredBy: 'self',
      enabled: ['AITG-APP-01', 'AITG-APP-12'],
      service: 'svc-ai-chat:flowboard-run',
    },
    async () => ({ text: result.text }),
    { text: 'I cannot help with that request.' },
  );
  return { text: guarded.result.text };
};

interface ExecuteBody {
  graph_id?: string;
  story_id?: string;
}

interface StoryEntryRow {
  entry_type?: string;
  metadata?: { flowboard?: { kind?: string; nodeId?: string; status?: string; output?: string } } | null;
}

/**
 * Reconstruct resume state from a run-story's prior provenance — the story_entries ARE the run
 * state, so a re-invoke after a consent-gate approval is idempotent. Returns undefined for a fresh
 * run (no flow_run entry yet) so the executor emits the flow_run umbrella exactly once.
 */
export function buildResumeState(entries: StoryEntryRow[]): FlowRunContext['resume'] | undefined {
  let hasFlowRun = false;
  const approvedGateIds: string[] = [];
  const pendingGateIds: string[] = [];
  const executedNodeIds: string[] = [];
  const priorOutputs: Record<string, string> = {};
  for (const e of entries) {
    const fb = e.metadata?.flowboard;
    if (!fb) continue;
    if (e.entry_type === 'flow_run') {
      hasFlowRun = true;
    } else if (e.entry_type === 'consent_request' && fb.kind === 'consent_request' && fb.nodeId) {
      (fb.status === 'approved' ? approvedGateIds : pendingGateIds).push(fb.nodeId);
    } else if (e.entry_type === 'automation_step' && fb.nodeId) {
      executedNodeIds.push(fb.nodeId);
      if (typeof fb.output === 'string' && fb.output) priorOutputs[fb.nodeId] = fb.output;
    }
  }
  return hasFlowRun ? { approvedGateIds, pendingGateIds, executedNodeIds, priorOutputs } : undefined;
}

export async function flowboardRunRoutes(app: FastifyInstance): Promise<void> {
  // Function-name route (gateway route table maps /functions/v1/flowboard-execute here),
  // so the web client reaches it with aisha.functions.invoke('flowboard-execute', { body }).
  app.post<{ Body: ExecuteBody }>(
    '/flowboard-execute',
    async (req, reply) => {
      const authHeader = req.headers.authorization ?? '';
      let jwt = '';
      let ownerId: string | null = null;
      try {
        if (!authHeader.startsWith('Bearer ey')) throw new Error('missing bearer token');
        const claims = await verifyToken(authHeader);
        ownerId = (claims as { sub?: string } | undefined)?.sub ?? null;
        jwt = authHeader.replace('Bearer ', '');
      } catch {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const graphId = req.body?.graph_id;
      const storyId = req.body?.story_id;
      if (!graphId || !storyId) {
        return reply.code(400).send({ error: 'graph_id and story_id are required' });
      }

      const pgrestUser = createUserRpcAdapter(jwt);

      // Load the authoritative graph (owner-scoped; SECURITY DEFINER).
      const { data, error } = await pgrestUser.rpc('get_flowboard_graph', { p_id: graphId });
      const row = data as { graph?: FlowGraph; name?: string; engine_pin?: string } | null;
      if (error || !row?.graph) {
        return reply.code(404).send({ error: 'Flow not found or access denied' });
      }

      // Fail-loud on a structurally-invalid stored graph. The graph column is "validated app-side"
      // at write time, but a verbatim-stored {} default (or a node missing `position`) would otherwise
      // throw an uncaught TypeError deep in the compiler (e.g. Math.round(inst.position.x)) and surface
      // as an opaque 500. Parse up front so BOTH engine targets reject it as a clean 422 with the errors.
      const parsedGraph = flowGraphSchema.safeParse({ ...row.graph, name: row.graph.name ?? row.name ?? 'Flow' });
      if (!parsedGraph.success) {
        return reply.code(422).send({
          error: 'invalid_graph',
          detail: 'stored flowboard graph failed schema validation',
          issues: parsedGraph.error.issues,
        });
      }
      const validGraph = parsedGraph.data;

      const engine = row.engine_pin === 'n8n' ? 'n8n' : 'sandbox';
      const runId = randomUUID();

      if (engine === 'n8n') {
        // n8n engine target: validate FOR THE ENGINE → compile → CREATE → ACTIVATE on the real n8n
        // instance (via ../lib/n8n-client — SSRF-guarded, __REMAP__-checked), then write the flow_run
        // provenance umbrella under the USER's JWT (same StoryLoop timeline as a sandbox run).
        // A 200 here means the workflow was really created + activated and provenance landed — not just
        // an echoed response. Per-node execution provenance (n8n storyEntry nodes / execution callback)
        // is the next layer; see flowboard-n8n.integration.test.
        const { data: agentRows } = await pgrestUser.rpc('get_flowboard_agent_catalog', {});
        const registry = await buildFlowRegistry([
          builtinProvider(),
          agentCatalogProvider(async () => (Array.isArray(agentRows) ? (agentRows as AgentCatalogRow[]) : [])),
        ]);
        const graphName = validGraph.name ?? row.name ?? 'Flow';
        // Engine-aware validation BEFORE any side effect, and BEFORE the n8n-config check — the
        // governance verdict must not depend on whether n8n happens to be configured. This rejects
        // (a) unknown node types (compileToN8n refuses silently dropped nodes) and (b) nodes whose
        // descriptor excludes the n8n engine — most importantly gate.consent / gate.compliance:
        // a consent gate compiled to n8n used to become a noOp passthrough, i.e. the human-approval
        // halt was silently DROPPED (fail-open). Now the whole n8n-pinned run fails CLOSED with 422
        // and the user runs the gated flow on the sandbox engine, where gates are enforced.
        const vg = validateGraph(validGraph, registry, { engine: 'n8n' });
        if (!vg.ok) {
          const engineBlocked = vg.errors.filter((e) => e.code === 'ENGINE_UNSUPPORTED_NODE');
          // Loud trace/audit record of the governance rejection (no story entry: a rejected run
          // must not pollute the resume state, which is reconstructed from story_entries).
          req.log?.error?.(
            { runId, graphId, storyId, errors: vg.errors, consentFailClosed: engineBlocked.length > 0 },
            'flowboard n8n run rejected by graph validation (fail-closed)',
          );
          return reply.code(422).send({ error: 'graph_validation_failed', runId, errors: vg.errors });
        }
        // When a reachable callback base is configured, inject the provenance callback node so n8n
        // POSTs the execution back → per-node automation_step provenance (/flowboard-n8n-callback).
        // FLOWBOARD_CALLBACK_BASE_URL is derived from the topology catalog (ai-chat internal_url).
        const callbackBase = (process.env.FLOWBOARD_CALLBACK_BASE_URL ?? '').replace(/\/$/, '');
        if (!callbackBase || !ownerId) {
          // Say it out loud. Without the callback this run still executes, but it records ONLY the
          // flow_run umbrella — no per-node automation_step. That makes the n8n engine less
          // auditable than the sandbox engine for the same graph, and a missing provenance trail
          // is invisible by construction: nothing errors, the entries simply never appear.
          req.log?.warn?.(
            { runId, graphId, storyId, hasCallbackBase: Boolean(callbackBase), hasOwnerId: Boolean(ownerId) },
            'flowboard n8n run WITHOUT per-node provenance — FLOWBOARD_CALLBACK_BASE_URL unresolved (topology delivery bug?)',
          );
        }
        let workflow: ReturnType<typeof compileToN8n>;
        try {
          workflow = compileToN8n(
            validGraph,
            registry,
            callbackBase && ownerId
              ? { callback: { url: `${callbackBase}/flowboard-n8n-callback`, storyId, ownerId, runId } }
              : {},
          );
        } catch (e) {
          req.log?.error?.({ err: String(e) }, 'flowboard compileToN8n threw');
          return reply.code(422).send({ error: 'compile_failed', runId, detail: String(e).slice(0, 200) });
        }
        let n8nWorkflowId: string | undefined;
        try {
          const pushed = await pushWorkflowToN8n(workflow);
          n8nWorkflowId = pushed.workflowId;
          // Contract (AISHA_FLOWBOARD_DESIGN.md): a 200 means created + ACTIVE + provenance. A
          // created-but-inactive workflow is a PARTIAL failure — activateWorkflowInN8n throws so we
          // fail loud (502) rather than report a success the FE (which does not inspect `active`)
          // would surface to the user as "started".
          await activateWorkflowInN8n(pushed.workflowId);
        } catch (err) {
          if (err instanceof N8nEngineError) {
            const status =
              err.code === 'not_configured' ? 503 : err.code === 'unresolved_placeholder' ? 422 : 502;
            req.log?.error?.({ runId, code: err.code, n8nWorkflowId: n8nWorkflowId ?? null, err: err.message }, 'flowboard n8n push failed');
            return reply
              .code(status)
              .send({ error: err.message, code: err.code, runId, n8nWorkflowId: n8nWorkflowId ?? null });
          }
          req.log?.error?.({ runId, err }, 'flowboard n8n push failed (unexpected)');
          return reply.code(500).send({ error: 'n8n push failed', runId });
        }
        // Provenance umbrella — written under the user's JWT, exactly like the sandbox engine. Only
        // after the workflow is confirmed created AND active, so a 200 always means a real, running flow.
        // StoryEntryParams is a fixed-shape record; widen for the generic RPC seam.
        const fbRun = buildFlowRunEntry({ storyId, runId, graphId, graphName, engine: 'n8n' });
        const { error: provErr } = await pgrestUser.rpc(
          'create_story_entry_audited',
          fbRun as unknown as Record<string, unknown>,
        );
        if (provErr) {
          req.log?.error?.({ provErr }, 'n8n flow_run provenance write failed');
          return reply.code(500).send({ error: 'provenance write failed', runId });
        }
        return reply.send({ runId, status: 'running_in_n8n', engine: 'n8n', n8nWorkflowId, active: true });
      }

      const graph: FlowGraph = { ...row.graph, name: row.graph.name ?? row.name };

      // Reconstruct resume state from prior provenance so a re-invoke after a consent approval
      // passes the approved gate + skips already-run nodes (the story_entries ARE the run state).
      const { data: entriesData } = await pgrestUser.rpc('get_story_entries_audited', {
        p_limit: 500,
        p_offset: 0,
        p_story_id: storyId,
      });
      const resume = buildResumeState(Array.isArray(entriesData) ? (entriesData as StoryEntryRow[]) : []);

      // Action nodes perform real outbound side-effects through the existing outbox RPC, under the
      // user's JWT (RLS + the RPC's own audit apply). Created per-request so it closes over pgrestUser.
      const dispatchAction: ActionDispatch = async ({ channel, recipient, payload, storyId: sid }) => {
        const { data, error } = await pgrestUser.rpc('aisha_notify_via_openclaw', {
          p_channel: channel,
          p_payload: payload,
          p_recipient: recipient,
          p_story_id: sid,
        });
        if (error) {
          const msg =
            typeof error === 'object' && error && 'message' in error
              ? String((error as { message: unknown }).message)
              : 'notify enqueue failed';
          throw new Error(msg);
        }
        const result = data as { notification_id?: string; id?: string } | null;
        return { notificationId: result?.notification_id ?? result?.id };
      };

      try {
        const result = await executeFlowGraph(
          graph,
          { storyId, graphId, runId, userId: null, engine: 'sandbox', resume },
          { pgrestUser, dispatch: dispatchAgent, actionDispatch: dispatchAction },
        );
        return reply.send(result);
      } catch (err) {
        req.log?.error?.({ err }, 'flowboard execute failed');
        return reply.code(500).send({ error: 'Flow execution failed' });
      }
    },
  );
}
