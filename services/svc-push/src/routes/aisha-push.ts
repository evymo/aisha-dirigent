import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AuthError, verifyToken } from '../auth.js';

/** Heartbeat cadence — holds the SSE connection open through idle proxies. */
const HEARTBEAT_INTERVAL_MS = 25_000;

/**
 * GET /aisha-push — authenticated Server-Sent-Events channel.
 *
 * The IDE extension opens this with `Accept: text/event-stream` and a user
 * JWT, expecting a long-lived stream of push events destined for that user.
 *
 * There is currently NO event PRODUCER inside svc-push (no Redis pub/sub, no
 * LISTEN/NOTIFY, no queue) to subscribe to, so this implements the
 * authenticated keepalive half of the contract: verify the JWT, emit an
 * initial `connected` event, then hold the socket open with periodic `: ping`
 * heartbeat comments until the client disconnects. Wiring an actual event
 * source is a follow-up (see structured assumptions).
 */
export async function aishaPushRoute(app: FastifyInstance): Promise<void> {
  app.get('/aisha-push', async (req: FastifyRequest, reply: FastifyReply) => {
    let user;
    try {
      user = await verifyToken(req.headers.authorization);
    } catch (err) {
      const status = err instanceof AuthError ? err.statusCode : 401;
      return reply.status(status).send({ error: 'Unauthorized' });
    }

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Initial handshake frame the IDE extension waits for.
    raw.write(`event: connected\ndata: ${JSON.stringify({ user_id: user.userId, ts: new Date().toISOString() })}\n\n`);

    const heartbeat = setInterval(() => {
      raw.write(': ping\n\n');
    }, HEARTBEAT_INTERVAL_MS);
    // Don't let the heartbeat timer keep the process alive on shutdown.
    heartbeat.unref?.();

    const cleanup = (): void => {
      clearInterval(heartbeat);
    };
    req.raw.on('close', cleanup);
    req.raw.on('error', cleanup);

    return reply;
  });
}
