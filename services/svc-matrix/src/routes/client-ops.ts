import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createSsrfGuard, parseHostAllowlist } from '@aisha/security';
import { verifyToken } from '../auth.js';
import { resolveMatrixIdentity, MatrixIdentityError } from '../matrix-identity.js';
import { config } from '../config.js';

/**
 * USER-facing Matrix client-server operations proxy.
 *
 * DISTINCT from POST/PUT /webhook — that route is the Synapse appservice
 * INGRESS (Synapse → us, authed by hs_token). This route is the EGRESS a
 * web/mobile client hits (client → us → Synapse CS API), authed by the
 * caller's own Keycloak user JWT.
 *
 * Every downstream Synapse call is made with the CALLER's client-server access
 * token (resolved from their KC identity via resolveMatrixIdentity), never an
 * admin/service token — so Synapse enforces room membership + power levels for
 * us (principle of least privilege). We do not widen the caller's authority.
 *
 * SSRF note: outbound requests all target the fixed, config-provided homeserver
 * base URL (config.synapseAdminUrl — the internal mesh Synapse CS API, same host
 * the token-exchange login uses). The only user-controlled data reaching a URL
 * are room/user identifiers, which are placed exclusively in PATH segments via
 * encodeURIComponent — never the host — so no host-level SSRF surface is opened.
 */

interface ClientOpsBody {
  action?: unknown;
  room_id?: unknown;
  limit?: unknown;
  content?: unknown;
  name?: unknown;
  topic?: unknown;
  is_direct?: unknown;
  user_id?: unknown;
}

/** A single Matrix timeline event as returned to the client. */
interface ClientMessage {
  event_id: string;
  sender: string;
  content: { msgtype: string; body: string };
  origin_server_ts: number;
  type: string;
}

const MAX_MESSAGE_LIMIT = 100;
const DEFAULT_MESSAGE_LIMIT = 50;

// OWASP A10 — every outbound Synapse CS-API call goes through the SSRF guard. The
// homeserver host is operator config (trust anchor), not user input; room/user ids
// only ever appear in encodeURIComponent'd PATH segments, never the host.
const SYNAPSE_HOST = (() => {
  try {
    return new URL(config.synapseAdminUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
})();
const ssrfGuard = createSsrfGuard({
  service: 'svc-matrix',
  hostAllowlist: [...parseHostAllowlist(config.ssrfHostAllowlist), SYNAPSE_HOST].filter(Boolean),
  // Internal mesh Synapse CS API is HTTP on a private host; the IP guard still
  // blocks loopback/link-local/metadata after DNS resolution.
  allowedSchemes: ['https:', 'http:'],
  allowInternalNetworks: true,
});

export async function clientOpsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/client-ops', async (req: FastifyRequest, reply: FastifyReply) => {
    // Keycloak user JWT. Throws AuthError(401) → mapped by the global handler.
    const user = await verifyToken(req.headers.authorization);

    const body: ClientOpsBody =
      typeof req.body === 'object' && req.body !== null ? (req.body as ClientOpsBody) : {};
    const action = typeof body.action === 'string' ? body.action : undefined;

    if (!action) {
      return reply.status(400).send({ error: 'Missing action' });
    }

    // Resolve the caller's Matrix CS-API token (idempotent account provisioning).
    let accessToken: string;
    try {
      ({ accessToken } = await resolveMatrixIdentity(user));
    } catch (err) {
      if (err instanceof MatrixIdentityError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }

    const base = config.synapseAdminUrl;
    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    } as const;

    switch (action) {
      case 'get_messages': {
        const roomId = requireString(body.room_id);
        if (!roomId) return reply.status(400).send({ error: 'Missing room_id' });
        const limit = clampLimit(body.limit);

        const url =
          `${base}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages` +
          `?dir=b&limit=${limit}`;
        const resp = await ssrfGuard.safeFetch(url, {
          method: 'GET',
          headers: authHeaders,
          signal: AbortSignal.timeout(10_000),
        });
        if (!resp.ok) {
          return reply.status(502).send({ error: 'Matrix get_messages failed' });
        }
        const data = (await resp.json()) as { chunk?: unknown; end?: unknown };
        const chunk = Array.isArray(data.chunk) ? data.chunk : [];
        // Only surface renderable room messages, shaped to the client contract.
        const messages: ClientMessage[] = chunk
          .filter(
            (e): e is Record<string, unknown> =>
              typeof e === 'object' && e !== null && (e as Record<string, unknown>).type === 'm.room.message',
          )
          .map((e) => {
            const content = (e.content ?? {}) as Record<string, unknown>;
            return {
              event_id: String(e.event_id ?? ''),
              sender: String(e.sender ?? ''),
              content: {
                msgtype: typeof content.msgtype === 'string' ? content.msgtype : 'm.text',
                body: typeof content.body === 'string' ? content.body : '',
              },
              origin_server_ts: typeof e.origin_server_ts === 'number' ? e.origin_server_ts : 0,
              type: 'm.room.message',
            };
          });
        const end = typeof data.end === 'string' ? data.end : undefined;
        return reply.send(end !== undefined ? { messages, end } : { messages });
      }

      case 'send_message': {
        const roomId = requireString(body.room_id);
        if (!roomId) return reply.status(400).send({ error: 'Missing room_id' });
        const content =
          typeof body.content === 'object' && body.content !== null
            ? (body.content as Record<string, unknown>)
            : undefined;
        if (!content || typeof content.body !== 'string') {
          return reply.status(400).send({ error: 'Missing content.body' });
        }

        // Client-generated transaction id makes the send idempotent per attempt.
        const txnId = crypto.randomUUID();
        const url =
          `${base}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}` +
          `/send/m.room.message/${encodeURIComponent(txnId)}`;
        const resp = await ssrfGuard.safeFetch(url, {
          method: 'PUT',
          headers: authHeaders,
          body: JSON.stringify({
            msgtype: typeof content.msgtype === 'string' ? content.msgtype : 'm.text',
            body: content.body,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!resp.ok) {
          return reply.status(502).send({ error: 'Matrix send_message failed' });
        }
        const data = (await resp.json()) as { event_id?: unknown };
        return reply.send({ event_id: String(data.event_id ?? '') });
      }

      case 'create_room': {
        const url = `${base}/_matrix/client/v3/createRoom`;
        const resp = await ssrfGuard.safeFetch(url, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            name: typeof body.name === 'string' ? body.name : undefined,
            topic: typeof body.topic === 'string' ? body.topic : undefined,
            is_direct: body.is_direct === true,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!resp.ok) {
          return reply.status(502).send({ error: 'Matrix create_room failed' });
        }
        const data = (await resp.json()) as { room_id?: unknown; room_alias?: unknown };
        const roomAlias = typeof data.room_alias === 'string' ? data.room_alias : undefined;
        return reply.send(
          roomAlias !== undefined
            ? { room_id: String(data.room_id ?? ''), room_alias: roomAlias }
            : { room_id: String(data.room_id ?? '') },
        );
      }

      case 'invite': {
        const roomId = requireString(body.room_id);
        if (!roomId) return reply.status(400).send({ error: 'Missing room_id' });
        const inviteeId = requireString(body.user_id);
        if (!inviteeId) return reply.status(400).send({ error: 'Missing user_id' });

        const url = `${base}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`;
        const resp = await ssrfGuard.safeFetch(url, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ user_id: inviteeId }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!resp.ok) {
          return reply.status(502).send({ error: 'Matrix invite failed' });
        }
        return reply.send({ success: true });
      }

      default:
        return reply.status(400).send({ error: `Unknown action: ${action}` });
    }
  });
}

function requireString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function clampLimit(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MESSAGE_LIMIT;
  return Math.min(Math.floor(n), MAX_MESSAGE_LIMIT);
}
