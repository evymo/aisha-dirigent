import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { verifyToken } from '../auth.js';
import { rpcService } from '../postgrest.js';
import { createEgressApiToken } from '../livekit-jwt.js';
import { config } from '../config.js';

// ── Request schema ──
const RecordingSchema = z.object({
  action: z.enum(['start', 'stop']),
  room_name: z.string().min(1).optional(),
  egress_id: z.string().min(1).optional(),
  session_id: z.string().min(1),
});

export async function recordingRoutes(app: FastifyInstance): Promise<void> {
  app.post('/recording', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await verifyToken(req.headers.authorization);

    const parseResult = RecordingSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid request body',
        details: parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }
    const { action, room_name, egress_id, session_id } = parseResult.data;

    // Verify session + participant + consent
    let session: Record<string, unknown>;
    try {
      const rows = await rpcService<Record<string, unknown>[]>('get_consultation_session', {
        p_session_id: session_id,
      });
      if (!rows?.[0]) throw new Error('not found');
      session = rows[0];
    } catch {
      return reply.status(404).send({ error: 'Session not found' });
    }

    if (session.caller_id !== user.userId && session.callee_id !== user.userId) {
      return reply.status(403).send({ error: 'Not a participant of this session' });
    }

    if (!session.recording_consent) {
      return reply.status(403).send({ error: 'Recording consent not granted' });
    }

    const egressToken = await createEgressApiToken();

    if (action === 'start') {
      if (!room_name) {
        return reply.status(400).send({ error: 'room_name is required for start' });
      }

      const egressResponse = await fetch(
        `${config.livekitHost}/twirp/livekit.Egress/StartRoomCompositeEgress`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${egressToken}`,
          },
          body: JSON.stringify({
            room_name,
            file_outputs: [
              {
                file_type: 0, // MP4
                filepath: `recordings/${session_id}/{room_name}-{time}.mp4`,
                s3: {
                  bucket: config.recordingS3Bucket,
                  region: config.recordingS3Region,
                  access_key: config.recordingS3AccessKey,
                  secret: config.recordingS3SecretKey,
                },
              },
            ],
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (!egressResponse.ok) {
        return reply.status(502).send({ egress_id: '', status: 'failed' });
      }

      const egressResult = await egressResponse.json() as { egress_id: string };

      // Track egress in session
      await rpcService('update_consultation_recording_egress', {
        p_recording_egress_id: egressResult.egress_id,
        p_session_id: session_id,
      }).catch(() => { /* non-critical */ });

      return reply.send({ egress_id: egressResult.egress_id, status: 'started' });
    }

    if (action === 'stop') {
      if (!egress_id) {
        return reply.status(400).send({ error: 'egress_id is required for stop' });
      }

      const stopResponse = await fetch(
        `${config.livekitHost}/twirp/livekit.Egress/StopEgress`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${egressToken}`,
          },
          body: JSON.stringify({ egress_id }),
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (!stopResponse.ok) {
        return reply.status(502).send({ egress_id, status: 'failed' });
      }

      return reply.send({ egress_id, status: 'stopped' });
    }

    return reply.status(400).send({ error: "Invalid action. Use 'start' or 'stop'" });
  });
}
