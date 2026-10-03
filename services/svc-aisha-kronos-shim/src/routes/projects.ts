/**
 * GET /projects/{project_id}/ — Kronos-compatible project metadata.
 *
 * Maestro očekává Alquist Project model (viz packages/insight/common/common/
 * models/project.py). Shim mapuje AISHA story → Project schema:
 *   - project_id  ← story_id (story-{uuid}) nebo string ID
 *   - title/name  ← partner_stories.title
 *   - lang        ← config.defaultLang (story neukládá lang field)
 *   - settings    ← project_preview JSONB
 *
 * Pokud project_id neodpovídá UUID story, vrací minimální stub (project může
 * existovat jen virtuálně pro shared "aisha" namespace).
 */
import type { FastifyInstance } from 'fastify';
import { verifyKronosApiKey, AuthError } from '../auth.js';
import { rpcService } from '../postgrest.js';
import { config } from '../config.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AishaStoryContext {
  story_id?: string;
  title?: string;
  partner_id?: string;
  status?: string;
  delivery_status?: string;
  project_preview?: Record<string, unknown>;
}

function buildProjectStub(projectId: string): Record<string, unknown> {
  return {
    project_id: projectId,
    name: projectId,
    description: 'AISHA virtual project (Kronos shim — bez upstream Kronos backend)',
    title: projectId,
    lang: config.defaultLang,
    settings: {},
    knowledge_base_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Extrahuje UUID z project_id ve formátu "story-{uuid}". Pro non-story
 * project_id (např. "aisha") vrací null.
 */
function extractStoryUuid(projectId: string): string | null {
  if (projectId.startsWith('story-')) {
    const candidate = projectId.slice('story-'.length);
    if (UUID_RE.test(candidate)) return candidate;
  }
  if (UUID_RE.test(projectId)) return projectId;
  return null;
}

export async function projectsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { project_id: string } }>('/projects/:project_id/', async (req, reply) => {
    try {
      verifyKronosApiKey(req.headers);
    } catch (err) {
      const status = err instanceof AuthError ? err.statusCode : 401;
      return reply.code(status).send({ detail: err instanceof Error ? err.message : 'Unauthorized' });
    }

    const projectId = req.params.project_id;
    const storyUuid = extractStoryUuid(projectId);

    if (!storyUuid) {
      // Virtual project — žádný AISHA story k namapování. Vrátíme stub.
      return reply.send(buildProjectStub(projectId));
    }

    try {
      const ctx = await rpcService<AishaStoryContext | null>('mcp_get_story_context', {
        p_story_id: storyUuid,
      });
      if (!ctx) {
        return reply.send(buildProjectStub(projectId));
      }
      return reply.send({
        project_id: projectId,
        name: ctx.title ?? projectId,
        description: `AISHA story ${storyUuid.substring(0, 8)} (status=${ctx.delivery_status ?? ctx.status ?? 'n/a'})`,
        title: ctx.title ?? projectId,
        lang: config.defaultLang,
        settings: ctx.project_preview ?? {},
        partner_id: ctx.partner_id ?? null,
        knowledge_base_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      req.log.warn({ err, storyUuid }, 'mcp_get_story_context failed — fallback na stub');
      return reply.send(buildProjectStub(projectId));
    }
  });
}
