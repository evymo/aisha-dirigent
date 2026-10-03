/**
 * ws-gateway topic authorization (GW-01).
 *
 * The WebSocket handshake authenticates the socket (4001 on a bad JWT), but
 * AFTER the handshake a client may ask to `subscribe` to any topic string. This
 * module is the authorization layer for that request: it decides, per
 * authenticated identity, whether a subscription to a given Redis pub/sub topic
 * is allowed. It default-DENIES — an unknown topic shape is rejected rather than
 * fanned out.
 *
 * Topic namespaces (produced by event-worker/src/worker.ts):
 *   • `ws:db:{schema}.{table}`   — raw DB-change stream. Privileged: it carries
 *                                   every row change on a table with no per-row
 *                                   scoping, so only admin/staff may subscribe.
 *   • `ws:storage`               — storage lifecycle events. Privileged (admin/staff).
 *   • `ws:broadcast:{topic}`     — intentional fan-out. Allowed for any
 *                                   authenticated client, EXCEPT a per-user
 *                                   broadcast (`…:user:{id}…`) which is owner-only.
 *
 * Anything that matches none of the above is denied.
 */
import { config } from './config.js';

/** The authenticated identity a subscription is authorized against. */
export interface TopicIdentity {
  /** JWT subject (Keycloak user id). */
  userId: string;
  /** Realm roles from the verified token. */
  roles: string[];
}

/**
 * Per-client subscription cap. A single socket may hold at most this many topic
 * subscriptions; further `subscribe` requests are rejected. Guards against a
 * client amplifying memory / Redis SUBSCRIBE fan-out into a DoS.
 */
export const MAX_TOPICS = config.maxTopics;

/** Roles permitted to read privileged (unscoped) streams. */
const PRIVILEGED_ROLES = new Set(['admin', 'staff', 'service_role']);

function isPrivileged(identity: TopicIdentity): boolean {
  return identity.roles.some((r) => PRIVILEGED_ROLES.has(r));
}

/**
 * Extract the owner id from a per-user topic segment, e.g.
 * `ws:broadcast:user:9f1c…:notifications` → `9f1c…`. Returns null when the topic
 * is not user-scoped.
 */
function ownerOf(topic: string): string | null {
  const m = topic.match(/(?:^|:)user:([A-Za-z0-9-]{8,})\b/);
  return m ? m[1] : null;
}

/**
 * Authorize `identity` to subscribe to `topic`. Default-deny: only the explicit
 * allow branches below return true.
 */
export function authorizeTopic(topic: string, identity: TopicIdentity): boolean {
  if (typeof topic !== 'string' || topic.length === 0) return false;

  // Per-user topics: only the owner (or an admin/staff operator) may listen.
  const owner = ownerOf(topic);
  if (owner !== null) {
    return owner === identity.userId || isPrivileged(identity);
  }

  // Raw DB-change and storage streams are unscoped → privileged roles only.
  if (topic.startsWith('ws:db:') || topic === 'ws:storage' || topic.startsWith('ws:storage:')) {
    return isPrivileged(identity);
  }

  // Intentional broadcast fan-out (non-user-scoped) is open to any authenticated
  // client.
  if (topic.startsWith('ws:broadcast:')) {
    return true;
  }

  // Unknown topic shape → deny.
  return false;
}
