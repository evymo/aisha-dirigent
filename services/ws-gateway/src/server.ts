import Fastify, { FastifyReply, FastifyRequest, type FastifyBaseLogger } from 'fastify';
import websocket from '@fastify/websocket';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { Redis } from 'ioredis';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { RawData, WebSocket } from 'ws';
import pino from 'pino';
import { buildHelmetOptions, buildGlobalRateLimitOptions, safeLoggerOptions } from '@aisha/security';
import { bootstrapOtel } from '@aisha/observability/otel';
import { registerMetricsPlugin } from '@aisha/observability/metrics';
import { config } from './config.js';
import { authorizeTopic, MAX_TOPICS } from './topic-auth.js';

const log = pino(safeLoggerOptions({ level: config.logLevel }));

// ── JWKS (built from config.jwksUri) ──
const jwks = createRemoteJWKSet(new URL(config.jwksUri));

interface AuthenticatedSocket {
  ws: WebSocket;
  userId: string;
  roles: string[];
  subscriptions: Set<string>;
  /** Heartbeat liveness flag — reset to false each tick, set true on 'pong'. */
  isAlive: boolean;
}

// ── State ──
const clients = new Map<WebSocket, AuthenticatedSocket>();
const topicSubscribers = new Map<string, Set<AuthenticatedSocket>>();

// ── Redis subscriber ──
const redisSub = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: null });

redisSub.on('message', (channel: string, message: string) => {
  const subs = topicSubscribers.get(channel);
  if (!subs || subs.size === 0) return;

  // Guard the parse: a single malformed payload on ANY channel must not throw
  // inside the ioredis 'message' emitter and crash the process. Log-and-drop.
  let data: unknown;
  try {
    data = JSON.parse(message);
  } catch (err) {
    log.warn({ err, channel }, 'Dropping malformed Redis pub/sub payload');
    return;
  }

  const frame = JSON.stringify({ type: 'event', channel, data });
  for (const client of subs) {
    if (client.ws.readyState === 1 /* OPEN */) {
      client.ws.send(frame);
    }
  }
});

// ── Auth ──
async function verifyToken(token: string): Promise<{ userId: string; roles: string[] } | null> {
  try {
    const { payload } = await jwtVerify(token, jwks, { audience: config.jwtAudience });
    const p = payload as JWTPayload & { sub?: string; realm_access?: { roles?: string[] } };
    if (!p.sub) return null;
    return {
      userId: p.sub,
      roles: p.realm_access?.roles ?? [],
    };
  } catch {
    return null;
  }
}

// ── Subscription management ──
/**
 * Attempt to subscribe `client` to `topic`. Returns `{ ok: true }` on success,
 * or `{ ok: false, reason }` when the request is refused — either the per-client
 * MAX_TOPICS cap is hit, or the identity is not authorized for the topic
 * (default-deny). The caller relays the reason to the socket.
 */
function subscribe(client: AuthenticatedSocket, topic: string): { ok: boolean; reason?: string } {
  if (client.subscriptions.has(topic)) return { ok: true };

  // (B) Per-client subscription cap — reject once the client holds MAX_TOPICS.
  if (client.subscriptions.size >= MAX_TOPICS) {
    log.warn({ userId: client.userId, topic, cap: MAX_TOPICS }, 'Subscription cap reached');
    return { ok: false, reason: `subscription cap (${MAX_TOPICS}) reached` };
  }

  // (A) Authorize the topic against the authenticated identity (default-deny).
  if (!authorizeTopic(topic, { userId: client.userId, roles: client.roles })) {
    log.warn({ userId: client.userId, topic }, 'Topic subscription denied');
    return { ok: false, reason: 'not authorized for topic' };
  }

  client.subscriptions.add(topic);

  let set = topicSubscribers.get(topic);
  if (!set) {
    set = new Set();
    topicSubscribers.set(topic, set);
    // First subscriber → Redis SUBSCRIBE
    redisSub.subscribe(topic).catch((err: unknown) => log.error({ err, topic }, 'Redis subscribe failed'));
  }
  set.add(client);
  log.debug({ userId: client.userId, topic }, 'Subscribed');
  return { ok: true };
}

function unsubscribe(client: AuthenticatedSocket, topic: string): void {
  client.subscriptions.delete(topic);
  const set = topicSubscribers.get(topic);
  if (set) {
    set.delete(client);
    if (set.size === 0) {
      topicSubscribers.delete(topic);
      redisSub.unsubscribe(topic).catch((err: unknown) => log.error({ err, topic }, 'Redis unsubscribe failed'));
    }
  }
}

function removeClient(client: AuthenticatedSocket): void {
  for (const topic of client.subscriptions) {
    unsubscribe(client, topic);
  }
  clients.delete(client.ws);
}

// ── Fastify App ──

// Phase 12 WP 0.4 — OTel auto-instrumentation must attach before any
// other module performs network I/O. Exporter routes to Langfuse OTLP.
// Rollback: OTEL_SDK_DISABLED=true env (Coolify) + container restart.
bootstrapOtel({ serviceName: 'ws-gateway' });
const app = Fastify({ loggerInstance: log as FastifyBaseLogger });

// OWASP A05 — security headers. CSP disabled (no browser-served HTML here).
await app.register(helmet, buildHelmetOptions({ enableContentSecurityPolicy: false }));

// OWASP A04 — rate limit non-WebSocket HTTP endpoints (/health). WebSocket
// connections bypass the limit; abuse protection for WS lives in the auth
// handshake (4001 on bad token) and per-topic subscription caps.
await app.register(rateLimit, buildGlobalRateLimitOptions({
  max: 600,
  timeWindow: 60_000,
  enabled: config.rateLimitEnabled,
}));

await registerMetricsPlugin(app, { serviceName: 'ws-gateway' });

await app.register(websocket);

app.get('/ws', { websocket: true }, (socket: WebSocket, req: FastifyRequest) => {
  // Auth: token from query string or first message
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const token = url.searchParams.get('token');

  if (!token) {
    socket.send(JSON.stringify({ type: 'error', message: 'Missing token query parameter' }));
    socket.close(4001, 'Unauthorized');
    return;
  }

  verifyToken(token).then((auth) => {
    if (!auth) {
      socket.send(JSON.stringify({ type: 'error', message: 'Invalid token' }));
      socket.close(4001, 'Unauthorized');
      return;
    }

    const client: AuthenticatedSocket = {
      ws: socket,
      userId: auth.userId,
      roles: auth.roles,
      subscriptions: new Set(),
      isAlive: true,
    };
    clients.set(socket, client);

    socket.send(JSON.stringify({ type: 'connected', userId: auth.userId }));
    log.info({ userId: auth.userId }, 'WS client connected');

    // Protocol-level pong (heartbeat) marks the socket alive for the next tick.
    socket.on('pong', () => { client.isAlive = true; });

    /** Relay a subscribe result: on refusal, tell the client why. */
    const trySubscribe = (topic: string): void => {
      const res = subscribe(client, topic);
      if (!res.ok) {
        socket.send(JSON.stringify({ type: 'subscribe_denied', topic, reason: res.reason }));
      }
    };

    socket.on('message', (raw: RawData) => {
      try {
        const msg = JSON.parse(String(raw)) as { type: string; topic?: string; topics?: string[] };

        switch (msg.type) {
          case 'subscribe':
            if (msg.topic) trySubscribe(msg.topic);
            if (msg.topics) msg.topics.forEach(trySubscribe);
            break;
          case 'unsubscribe':
            if (msg.topic) unsubscribe(client, msg.topic);
            break;
          case 'ping':
            socket.send(JSON.stringify({ type: 'pong' }));
            break;
          default:
            log.warn({ type: msg.type }, 'Unknown message type');
        }
      } catch {
        log.warn('Invalid WS message');
      }
    });

    socket.on('close', () => {
      removeClient(client);
      log.info({ userId: auth.userId }, 'WS client disconnected');
    });
  }).catch((err) => {
    log.error({ err }, 'Token verification error');
    socket.close(4001, 'Unauthorized');
  });
});

// ── Heartbeat ──
// Ping every socket each interval; a socket that did not 'pong' since the last
// tick is presumed dead — terminate it and reap its subscriptions so `clients`
// / `topicSubscribers` cannot leak half-open sockets forever.
const heartbeat = setInterval(() => {
  for (const [socket, client] of clients) {
    if (!client.isAlive) {
      log.info({ userId: client.userId }, 'Terminating unresponsive socket');
      removeClient(client);
      socket.terminate();
      continue;
    }
    client.isAlive = false;
    try {
      socket.ping();
    } catch (err) {
      log.warn({ err, userId: client.userId }, 'Ping failed; terminating');
      removeClient(client);
      socket.terminate();
    }
  }
}, config.heartbeatIntervalMs);
heartbeat.unref?.();

// Health endpoint for docker healthcheck
app.get('/health', async () => ({ status: 'ok', clients: clients.size }));

// ── Start ──
async function start(): Promise<void> {
  await redisSub.connect();
  log.info('Redis subscriber connected');

  await app.listen({ port: config.port, host: '0.0.0.0' });
  log.info({ port: config.port }, 'WS Gateway listening');
}

async function shutdown(): Promise<void> {
  log.info('Shutting down…');
  clearInterval(heartbeat);
  await app.close();
  redisSub.disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });

start().catch((err) => {
  log.fatal({ err }, 'Failed to start WS Gateway');
  process.exit(1);
});
