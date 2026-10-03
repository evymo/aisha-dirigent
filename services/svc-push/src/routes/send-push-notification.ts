import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { rpcService } from '../postgrest.js';
import { AuthError, isAdminOrStaff, verifyServiceRole, verifyToken } from '../auth.js';
import { deliverPush } from './send-push.js';

/**
 * Role-targeted broadcast request.
 *
 * Callers supply EITHER explicit recipients ({ user_id } / { user_ids }) OR
 * { target_roles } (n8n cron/alert workflows). `title`/`body` are mandatory;
 * `category` is an optional tag threaded through as push data.
 */
interface BroadcastBody {
  title?: string;
  body?: string;
  category?: string;
  user_id?: string;
  user_ids?: string[];
  target_roles?: string[];
  link?: string;
  badge?: number;
  sound?: string;
  priority?: 'high' | 'normal';
  send_mobile?: boolean;
  send_web?: boolean;
}

/**
 * Explicit runtime type guards for the untrusted broadcast body.
 *
 * `req.body` is attacker-controlled JSON; the `BroadcastBody` cast is a
 * compile-time fiction. Reject mistyped fields BEFORE recipient resolution —
 * critically, a string `user_ids` (e.g. "abc") must NOT be accepted, or it
 * would later be spread into per-character recipient IDs (['a','b','c']).
 * Returns an error message string on the first violation, or null when valid.
 */
function validateBroadcastBody(body: BroadcastBody): string | null {
  const stringFields: Array<[keyof BroadcastBody, unknown]> = [
    ['title', body.title],
    ['body', body.body],
    ['sound', body.sound],
    ['priority', body.priority],
    ['user_id', body.user_id],
  ];
  for (const [name, value] of stringFields) {
    if (value !== undefined && typeof value !== 'string') {
      return `${String(name)} must be a string`;
    }
  }
  if (
    body.user_ids !== undefined &&
    (!Array.isArray(body.user_ids) || body.user_ids.some((id) => typeof id !== 'string'))
  ) {
    return 'user_ids must be an array of strings';
  }
  return null;
}

/**
 * Authorize a privileged broadcast: allow either a valid service-role token
 * (n8n cron/alert callers) OR a user JWT carrying the admin/staff role.
 * Writes the rejection response and returns false on failure.
 */
async function authorizeBroadcast(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const authHeader = req.headers.authorization;

  // Service-role token — the n8n WF_SENTRY_MONITOR / WF_VULNERABILITY_SCAN path.
  try {
    verifyServiceRole(authHeader);
    return true;
  } catch {
    // Not the service token — fall through and try an admin/staff user JWT.
  }

  // Admin/staff user JWT.
  try {
    const user = await verifyToken(authHeader);
    if (isAdminOrStaff(user)) {
      return true;
    }
    reply.status(403).send({ error: 'Forbidden: admin or staff role required' });
    return false;
  } catch (err) {
    const status = err instanceof AuthError ? err.statusCode : 401;
    reply.status(status).send({ error: 'Unauthorized' });
    return false;
  }
}

/**
 * Resolve app roles to a de-duplicated list of internal user IDs via the
 * platform's existing `get_keycloak_ids_for_role` RPC (the same source the
 * Keycloak role-sync path uses). No table name is invented here.
 */
async function resolveRoleRecipients(roles: string[]): Promise<string[]> {
  const ids = new Set<string>();
  for (const role of roles) {
    const rows = await rpcService<Array<{ user_id?: string }> | null>('get_keycloak_ids_for_role', {
      p_role: role,
    });
    for (const row of rows ?? []) {
      if (typeof row?.user_id === 'string') {
        ids.add(row.user_id);
      }
    }
  }
  return [...ids];
}

export async function sendPushNotificationRoute(app: FastifyInstance): Promise<void> {
  app.post('/send-push-notification', async (req: FastifyRequest, reply: FastifyReply) => {
    // Privileged action — service-role OR admin/staff only (least privilege).
    if (!(await authorizeBroadcast(req, reply))) {
      return reply; // rejection response already written
    }

    const body = (req.body ?? {}) as BroadcastBody;

    // Reject mistyped fields before any recipient resolution (see guard doc).
    const typeError = validateBroadcastBody(body);
    if (typeError) {
      return reply.status(400).send({ error: typeError });
    }

    if (!body.title || !body.body) {
      return reply.status(400).send({ error: 'Missing required fields: title, body' });
    }

    const explicitIds = body.user_ids ?? (body.user_id ? [body.user_id] : []);
    const roles = Array.isArray(body.target_roles)
      ? body.target_roles.filter((r): r is string => typeof r === 'string' && r.length > 0)
      : [];

    if (explicitIds.length === 0 && roles.length === 0) {
      return reply.status(400).send({
        error: 'Must provide user_id, user_ids, or target_roles',
      });
    }

    let roleIds: string[] = [];
    if (roles.length > 0) {
      try {
        roleIds = await resolveRoleRecipients(roles);
      } catch (err) {
        req.log.error({ err }, 'role recipient resolution failed');
        return reply.status(502).send({ error: 'Failed to resolve target_roles' });
      }
    }

    const recipients = [...new Set([...explicitIds, ...roleIds])];

    // Valid request, but no users match the given roles — return zero counts
    // (not a 400: the input shape was well-formed). The response shape is kept
    // identical to a normal delivery (mobile_*/web_*/channels present) so clients
    // get a stable contract regardless of recipient count.
    if (recipients.length === 0) {
      return reply.send({
        recipients: 0,
        target_roles: roles.length > 0 ? roles : undefined,
        success: true,
        sent: 0,
        failed: 0,
        mobile_sent: 0,
        mobile_failed: 0,
        mobile_targeted: 0,
        web_sent: 0,
        web_failed: 0,
        web_targeted: 0,
        channels: { mobile: body.send_mobile !== false, web: body.send_web !== false },
        message: 'No recipients resolved',
      });
    }

    let result;
    try {
      result = await deliverPush(
        {
          title: body.title,
          body: body.body,
          data: body.category ? { category: body.category } : undefined,
          link: body.link,
          badge: body.badge,
          sound: body.sound,
          priority: body.priority,
          send_mobile: body.send_mobile,
          send_web: body.send_web,
        },
        recipients,
      );
    } catch (err) {
      // Recipient-lookup / delivery RPC threw — fail loud with a 5xx.
      req.log.error({ err }, 'broadcast push delivery failed');
      return reply.status(502).send({ success: false, error: 'Push delivery failed' });
    }

    return reply.send({
      recipients: recipients.length,
      target_roles: roles.length > 0 ? roles : undefined,
      ...result,
    });
  });
}
