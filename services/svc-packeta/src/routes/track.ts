import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken } from '../auth.js';
import { config } from '../config.js';
import { parseTrackingXml } from '../lib/packeta-xml.js';

/**
 * Track a Packeta shipment by packet ID.
 */
export async function trackRoutes(app: FastifyInstance): Promise<void> {
  app.get('/track/:packetId', async (req: FastifyRequest, reply: FastifyReply) => {
    await verifyToken(req.headers.authorization);

    const { packetId } = req.params as { packetId: string };
    if (!packetId || !/^\d+$/.test(packetId)) {
      return reply.status(400).send({ error: 'Invalid packet ID' });
    }

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<packetTracking>
  <apiPassword>${config.packetaApiKey}</apiPassword>
  <packetId>${packetId}</packetId>
</packetTracking>`;

    const res = await fetch(config.packetaApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml' },
      body: xml,
      signal: AbortSignal.timeout(10_000),
    });

    const responseText = await res.text();

    if (!res.ok) {
      return reply.status(502).send({ error: 'Packeta tracking API error' });
    }

    // Parse tracking records from XML (shared helper — identical fields to /packeta-api)
    const records = parseTrackingXml(responseText);

    return reply.send({ packet_id: packetId, tracking: records });
  });
}
