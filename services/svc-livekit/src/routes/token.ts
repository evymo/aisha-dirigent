import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { verifyToken } from '../auth.js';
import { rpcService } from '../postgrest.js';
import { createRoomAccessToken } from '../livekit-jwt.js';

/** Řádek z get_voice_room_entry (aisha/db/sql/functions/get_voice_room_entry.sql). */
export interface VoiceRoomEntry {
  id: string;
  is_active: boolean;
  story_id: string | null;
  room_type: string;
  may_enter: boolean;
}

// ── Request schema ──
const CreateTokenSchema = z.object({
  roomName: z.string().min(1),
  canPublish: z.boolean().default(true),
  canSubscribe: z.boolean().default(true),
});

export async function tokenRoutes(app: FastifyInstance): Promise<void> {
  app.post('/create-token', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await verifyToken(req.headers.authorization);

    const parseResult = CreateTokenSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid request body',
        details: parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }
    const { roomName, canPublish, canSubscribe } = parseResult.data;

    // Místnost + verdikt vstupu v JEDNOM dotazu: rozhoduje DB (can_enter_voice_room),
    // ne služba — totéž pravidlo hlídá i get_room_participants. Dřív trasa volala dvě
    // RPC, která nikdy neexistovala (každá místnost = 404), a u konzultace bez story
    // nekontrolovala nic: token do cizího hovoru (audit hlasu 2026-09-29, H-5).
    let voiceRoom: VoiceRoomEntry;
    try {
      const rows = await rpcService<VoiceRoomEntry[]>('get_voice_room_entry', {
        p_livekit_room_name: roomName,
        p_user_id: user.userId,
      });
      if (!rows?.[0]) return reply.status(404).send({ error: 'Room not found' });
      voiceRoom = rows[0];
    } catch (err) {
      // Chyba dotazu není „místnost neexistuje“ — fail-closed a viditelně.
      req.log.error({ err }, 'get_voice_room_entry failed');
      return reply.status(503).send({ error: 'Room lookup unavailable' });
    }

    if (!voiceRoom.is_active) {
      return reply.status(403).send({ error: 'Room is closed' });
    }
    if (voiceRoom.may_enter !== true) {
      return reply.status(403).send({ error: 'Not allowed in this room' });
    }

    // Get display name
    let displayName = 'Anonymous';
    try {
      const profile = await rpcService<Record<string, unknown> | null>('get_profile_display_name', {
        p_user_id: user.userId,
      });
      if (profile?.display_name) displayName = profile.display_name as string;
    } catch { /* fallback to Anonymous */ }

    const token = await createRoomAccessToken({
      identity: user.userId,
      name: displayName,
      roomName,
      canPublish,
      canSubscribe,
      roomType: voiceRoom.room_type ?? 'default',
    });

    // Record participant join
    await rpcService('upsert_call_participant', {
      p_joined_at: new Date().toISOString(),
      p_role: 'participant',
      p_user_id: user.userId,
      p_voice_room_id: voiceRoom.id,
    }).catch(() => { /* non-critical */ });

    return reply.send({ token, identity: user.userId, name: displayName, roomName });
  });
}
