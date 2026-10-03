/**
 * POST /router — Route task to appropriate agents.
 * POST /context — Compose context bundle for a story.
 */
import type { FastifyInstance } from 'fastify';
import { verifyToken, verifyServiceRole, AuthError } from '../auth.js';
import { rpcService } from '../postgrest.js';

const VALID_TASK_KINDS = [
  'chat',
  'project_delivery',
  'compliance_check',
  'guild_review',
  'pr_gate',
  'incident',
  'doc_update',
  // Web artifact pipeline tasks — route_task dispatches via dirigent
  // decision tree; falls back to 'librarian' until occipitum agent
  // is registered in agent_catalog on this stack (see migration
  // 20260516170000_occipitum_agent_catalog.sql).
  'web_design',
  'occipitum_design',
  'occipitum_redesign',
];

export async function orchestrationRoutes(app: FastifyInstance): Promise<void> {
  /** POST /router — Route task to agents + models */
  app.post<{
    Body: {
      task_kind: string;
      risk_profile?: string;
      domain?: string[];
      tech?: string[];
      story_id?: string;
      constraints?: Record<string, unknown>;
    };
  }>('/router', async (req, reply) => {
    // Dual auth: KC JWT or service-role
    let isService = false;
    try {
      verifyServiceRole(req.headers.authorization);
      isService = true;
    } catch {
      try {
        await verifyToken(req.headers.authorization);
      } catch (err) {
        return reply.code(err instanceof AuthError ? err.statusCode : 401).send({ error: 'Unauthorized' });
      }
    }

    const { task_kind, risk_profile, domain, tech, story_id, constraints } = req.body ?? {};

    if (!task_kind || !VALID_TASK_KINDS.includes(task_kind)) {
      return reply.code(400).send({ error: `task_kind must be one of: ${VALID_TASK_KINDS.join(', ')}` });
    }

    const routePlan = await rpcService('route_task', {
      p_constraints: constraints ?? {},
      p_domain: domain ?? [],
      p_risk_profile: risk_profile ?? 'low',
      p_story_id: story_id ?? null,
      p_task_kind: task_kind,
      p_tech: tech ?? [],
    });

    return reply.send({ success: true, route_plan: routePlan });
  });

  /** POST /context — Compose context bundle */
  app.post<{
    Body: {
      story_id: string;
      context_profile_slug?: string;
      run_id?: string;
      query?: string;
      ragnarok_enabled?: boolean;
    };
  }>('/context', async (req, reply) => {
    // Dual auth
    let isService = false;
    try {
      verifyServiceRole(req.headers.authorization);
      isService = true;
    } catch {
      try {
        await verifyToken(req.headers.authorization);
      } catch (err) {
        return reply.code(err instanceof AuthError ? err.statusCode : 401).send({ error: 'Unauthorized' });
      }
    }

    const { story_id, context_profile_slug, run_id, query } = req.body ?? {};

    if (!story_id) {
      return reply.code(400).send({ error: 'story_id is required' });
    }

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(story_id)) {
      return reply.code(400).send({ error: 'story_id must be a valid UUID' });
    }

    const bundle = await rpcService<Record<string, unknown>>('compose_context', {
      p_story_id: story_id,
      p_context_profile_slug: context_profile_slug ?? 'repo_plus_rules',
      p_run_id: run_id ?? null,
      p_query: query ?? null,
    });

    return reply.send({ success: true, context: bundle });
  });
}
