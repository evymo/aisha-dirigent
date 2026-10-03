/**
 * AI Task CRUD — async AI tasks management.
 * POST /task (create), GET /task (status/list), DELETE /task (cancel).
 */
import type { FastifyInstance } from 'fastify';
import { verifyToken, AuthError, type VerifiedUser } from '../auth.js';
import { rpcUser } from '../postgrest.js';

const ALLOWED_TYPES = ['batch_analysis', 'data_export', 'evaluation_run', 'knowledge_sync', 'report_generation'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TaskCreateBody {
  task_type: string;
  parameters?: Record<string, unknown>;
  priority?: 'low' | 'normal' | 'high';
}

interface TaskQuery {
  limit?: string;
  status?: string;
  task_id?: string;
}

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  // Create task
  app.post<{ Body: TaskCreateBody }>('/task', async (req, reply) => {
    let user: VerifiedUser;
    let jwt: string;
    try {
      user = await verifyToken(req.headers.authorization);
      jwt = (req.headers.authorization ?? '').replace('Bearer ', '');
    } catch (err) {
      return reply.code(err instanceof AuthError ? err.statusCode : 401).send({ error: 'Unauthorized' });
    }

    const { task_type, parameters, priority } = req.body ?? {};
    if (!task_type || !(ALLOWED_TYPES as readonly string[]).includes(task_type)) {
      return reply.code(400).send({ error: `task_type must be one of: ${ALLOWED_TYPES.join(', ')}` });
    }

    const result = await rpcUser<{ task_id: string; status: string }>('create_ai_task', {
      p_parameters: parameters ?? {},
      p_priority: priority ?? 'normal',
      p_task_type: task_type,
      p_user_id: user.userId,
    }, jwt);

    return reply.code(201).send(result);
  });

  // Get task status or list
  app.get<{ Querystring: TaskQuery }>('/task', async (req, reply) => {
    let user: VerifiedUser;
    let jwt: string;
    try {
      user = await verifyToken(req.headers.authorization);
      jwt = (req.headers.authorization ?? '').replace('Bearer ', '');
    } catch (err) {
      return reply.code(err instanceof AuthError ? err.statusCode : 401).send({ error: 'Unauthorized' });
    }

    const { task_id, status, limit } = req.query ?? {};

    if (task_id) {
      if (!UUID_RE.test(task_id)) {
        return reply.code(400).send({ error: 'task_id must be a valid UUID' });
      }
      const task = await rpcUser<unknown>('get_ai_task_status', { p_task_id: task_id }, jwt);
      if (!task) return reply.code(404).send({ error: 'Task not found' });
      return reply.send(task);
    }

    const tasks = await rpcUser<unknown[]>('get_my_ai_tasks', {
      p_limit: Math.min(parseInt(limit ?? '20', 10) || 20, 100),
      p_status: status ?? null,
    }, jwt);

    return reply.send({ tasks: tasks ?? [] });
  });

  // Cancel task
  app.delete<{ Querystring: { task_id?: string } }>('/task', async (req, reply) => {
    let user: VerifiedUser;
    let jwt: string;
    try {
      user = await verifyToken(req.headers.authorization);
      jwt = (req.headers.authorization ?? '').replace('Bearer ', '');
    } catch (err) {
      return reply.code(err instanceof AuthError ? err.statusCode : 401).send({ error: 'Unauthorized' });
    }

    const taskId = req.query?.task_id;
    if (!taskId || !UUID_RE.test(taskId)) {
      return reply.code(400).send({ error: 'task_id query parameter is required' });
    }

    const result = await rpcUser<{ cancelled: boolean }>('cancel_ai_task', { p_task_id: taskId }, jwt);
    return reply.send(result ?? { cancelled: false });
  });
}
