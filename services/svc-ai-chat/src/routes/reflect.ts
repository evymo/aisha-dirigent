/**
 * POST /reflect/runs                    — start (or resume) a reflection workflow run
 * POST /reflect/runs/:id/approve        — resume a paused run after human approval
 * POST /reflect/runs/:id/resume-batch   — resume a run paused on batch dispatch
 *                                          (called by WF_BATCH_RESUMER after batch
 *                                          result was fetched + persisted)
 * GET  /reflect/runs/:id                — read current run state
 *
 * Reflection runtime is an in-process capability of svc-ai-chat. There is no
 * separate svc-langgraph-runner service — orchestration nodes call llmRouter
 * directly. Authoritative source-of-truth: ai_workflow_definitions.graph JSONB.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyServiceRole, AuthError } from '../auth.js';
import {
  runWorkflow,
  resumeAfterApproval,
  resumeAfterBatch,
} from '../reflection/orchestrator.js';
import { loadRun } from '../reflection/checkpointer.js';
import { authenticateOmniIdentity } from './omniAuth.js';
import { rpcService } from '../postgrest.js';

const StartSchema = z.object({
  run_id: z.string().uuid(),
});

const ApprovalSchema = z.object({
  approved: z.boolean(),
  note: z.string().optional(),
});

export async function reflectRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { run_id?: string } }>('/reflect/runs', async (req, reply) => {
    try {
      verifyServiceRole(req.headers.authorization);
    } catch (err) {
      return reply
        .code(err instanceof AuthError ? err.statusCode : 401)
        .send({ error: 'Unauthorized' });
    }

    const parsed = StartSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.message });
    }

    // §20 P2: validate the run EXISTS before firing the workflow. Without this,
    // a non-existent run_id returned 202 and runWorkflow's loadRun throw was only
    // logged → silent failure. A missing run must be a clear 404 run_not_found.
    const existingRun = await loadRun(parsed.data.run_id);
    if (!existingRun) {
      return reply.code(404).send({ error: 'run_not_found' });
    }

    // Fire-and-respond: run async, return run_id immediately.
    void runWorkflow(parsed.data.run_id).catch((err) => {
      app.log.error({ err, run_id: parsed.data.run_id }, 'reflection runWorkflow failed');
    });

    return reply.code(202).send({ accepted: true, run_id: parsed.data.run_id });
  });

  app.post<{ Params: { id: string }; Body: { approved?: boolean; note?: string } }>(
    '/reflect/runs/:id/approve',
    async (req, reply) => {
      try {
        verifyServiceRole(req.headers.authorization);
      } catch (err) {
        return reply
          .code(err instanceof AuthError ? err.statusCode : 401)
          .send({ error: 'Unauthorized' });
      }

      const parsed = ApprovalSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.message });
      }

      void resumeAfterApproval(req.params.id, parsed.data.approved, parsed.data.note).catch(
        (err) => {
          app.log.error(
            { err, run_id: req.params.id },
            'reflection resumeAfterApproval failed',
          );
        },
      );

      return reply.code(202).send({ accepted: true, run_id: req.params.id });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/reflect/runs/:id/resume-batch',
    async (req, reply) => {
      try {
        verifyServiceRole(req.headers.authorization);
      } catch (err) {
        return reply
          .code(err instanceof AuthError ? err.statusCode : 401)
          .send({ error: 'Unauthorized' });
      }

      // Body is intentionally minimal — the batch_result has already been
      // persisted into ai_runs.metadata.checkpoint.state by
      // persist_batch_result_and_resume RPC (which WF_BATCH_RESUMER calls
      // immediately before this endpoint). This route just kicks off the
      // orchestrator re-invocation.
      //
      // Fire-and-respond: orchestrator runs async, 202 immediately. n8n
      // doesn't need to wait for completion — its observability path is the
      // ai_runs row + audit_journal entries.
      void resumeAfterBatch(req.params.id).catch((err) => {
        app.log.error(
          { err, run_id: req.params.id },
          'reflection resumeAfterBatch failed',
        );
      });

      return reply.code(202).send({ accepted: true, run_id: req.params.id });
    },
  );

  app.get<{ Params: { id: string } }>('/reflect/runs/:id', async (req, reply) => {
    // Dual-auth so the documented poll contract is usable by the caller that received it:
    // internal callers (n8n, services) use service-role; an EXTERNAL Omni /v1 client polls
    // its deferred tier3+ run with the SAME PAT the 202 handshake accepted (the 202 advertised
    // X-Stream-Poll-URL → here). The PAT only establishes IDENTITY here (no body story-binding,
    // so scoped, UNSCOPED, and LEGACY PATs can all reach the resource check); authorization is
    // on-behalf-of against the LOADED run (fn_user_can_read_run), not a forced-empty body.
    let isService = false;
    let identity: { userId: string | null; scopedToStory: string | null } | null = null;
    try {
      verifyServiceRole(req.headers.authorization);
      isService = true;
    } catch {
      const id = await authenticateOmniIdentity(req.headers.authorization);
      if (!id.ok) return reply.code(id.http).send(id.body);
      identity = { userId: id.userId, scopedToStory: id.scopedToStory };
    }

    const run = await loadRun(req.params.id);
    if (!run) return reply.code(404).send({ error: 'run_not_found' });
    // Authorization (fail-closed). A foreign OR unknown run returns an identical 404 (no
    // existence oracle). A SCOPED PAT is authorized by its bind-at-issuance scope matching
    // the run's story — UNCHANGED, no regression for scoped PATs. An UNSCOPED/LEGACY PAT has
    // no token scope, so it is authorized ON-BEHALF-OF: its user must own/participate in the
    // run's story (or be admin) via fn_user_can_read_run — letting the user that STARTED a
    // deferred run drain it. Neither path relaxes the §8.5 token binding /v1 turns enforce.
    if (!isService && identity) {
      let authorized = false;
      if (identity.scopedToStory) {
        authorized = run.story_id === identity.scopedToStory;
      } else {
        try {
          authorized = (await rpcService<boolean>('fn_user_can_read_run', {
            p_run_id: req.params.id,
            p_user_id: identity.userId,
          })) === true;
        } catch {
          authorized = false;
        }
      }
      if (!authorized) return reply.code(404).send({ error: 'run_not_found' });
    }

    return reply.send({
      id: run.id,
      status: run.status,
      workflow_definition_id: run.workflow_definition_id,
      story_id: run.story_id,
      current_node: run.metadata.checkpoint?.current_node ?? null,
      iteration: run.metadata.checkpoint?.iteration ?? 0,
      cost_total: run.cost_total_json,
    });
  });
}
