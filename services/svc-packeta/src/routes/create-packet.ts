import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken } from '../auth.js';
import { rpcService } from '../postgrest.js';
import { config } from '../config.js';
import { buildPacketXml, type BuildPacketInput } from '../lib/packeta-xml.js';

type CreatePacketBody = BuildPacketInput;

/**
 * Create a Packeta shipment via Zásilkovna XML API v4.
 */
export async function createPacketRoutes(app: FastifyInstance): Promise<void> {
  app.post('/create-packet', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await verifyToken(req.headers.authorization);

    const body = req.body as CreatePacketBody | null;
    if (!body?.order_id || !body.recipient?.name || !body.recipient?.surname) {
      return reply.status(400).send({ error: 'order_id and recipient name/surname are required' });
    }

    // Build Packeta XML payload (shared helper — includes cod + note)
    const xml = buildPacketXml(body);

    const res = await fetch(config.packetaApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml' },
      body: xml,
      signal: AbortSignal.timeout(15_000),
    });

    const responseText = await res.text();

    if (!res.ok) {
      return reply.status(502).send({ error: 'Packeta API error', detail: responseText.slice(0, 200) });
    }

    // Extract packet ID from response
    const packetIdMatch = responseText.match(/<id>(\d+)<\/id>/);
    const barcodeMatch = responseText.match(/<barcode>([^<]+)<\/barcode>/);
    const packetId = packetIdMatch?.[1];
    const barcode = barcodeMatch?.[1];

    if (!packetId) {
      // Check for Packeta error
      const errorMatch = responseText.match(/<fault>([^<]+)<\/fault>/);
      return reply.status(422).send({
        error: 'Packeta rejected the packet',
        detail: errorMatch?.[1] ?? 'Unknown error',
      });
    }

    // Store shipment reference via RPC
    await rpcService('create_shipment_record', {
      p_barcode: barcode ?? null,
      p_carrier: 'packeta',
      p_external_id: packetId,
      p_order_id: body.order_id,
      p_status: 'created',
      p_user_id: user.userId,
    }).catch(() => { /* non-critical audit */ });

    return reply.send({
      packet_id: packetId,
      barcode: barcode ?? null,
      status: 'created',
    });
  });
}
