import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken, type VerifiedUser } from '../auth.js';
import { getBranches, getCarriers, sortByDistance, calculateShippingCost } from '../packeta-feed.js';
import { rpcService } from '../postgrest.js';
import { config } from '../config.js';
import { buildPacketXml, parseTrackingXml, type PacketRecipient } from '../lib/packeta-xml.js';
import { resolveBaseCurrency } from '../lib/currency.js';
import { createSsrfGuard, parseHostAllowlist } from '@aisha/security';

/**
 * Unified action-dispatcher for the Packeta integration.
 *
 * The web client (`aisha.functions.invoke('packeta-api', { body })`) targets a
 * single function name and selects the operation via `body.action`. This route
 * fans that single POST out to the same four operations exposed by the REST
 * routes (GET /pickup-points, GET /available-methods, POST /create-packet,
 * GET /track/:packetId), normalizing the client's field names to what each
 * operation reads. The four REST routes remain unchanged; this file replicates
 * their operation logic against the shared helpers so their behavior is
 * preserved verbatim.
 *
 * Every action requires a valid bearer token (parity with the REST routes,
 * none of which apply an admin/staff gate).
 */

// OWASP A10 — every outbound Packeta vendor call goes through the SSRF guard.
// packetaApiUrl is operator config (fixed public HTTPS vendor endpoint), never a
// URL from client/LLM input; the IP guard still blocks metadata/loopback after DNS.
const PACKETA_HOST = (() => {
  try {
    return new URL(config.packetaApiUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
})();
const ssrfGuard = createSsrfGuard({
  service: 'svc-packeta',
  hostAllowlist: [...parseHostAllowlist(config.ssrfHostAllowlist), PACKETA_HOST].filter(Boolean),
  allowedSchemes: ['https:'],
  allowInternalNetworks: false,
});

export async function packetaApiRoutes(app: FastifyInstance): Promise<void> {
  app.post('/packeta-api', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await verifyToken(req.headers.authorization);

    const body = (req.body ?? {}) as { action?: unknown } & Record<string, unknown>;
    const action = typeof body.action === 'string' ? body.action : undefined;

    switch (action) {
      case 'pickup-points':
        return handlePickupPoints(reply, body);
      case 'available-methods':
        return handleAvailableMethods(reply, body);
      case 'create-packet':
        return handleCreatePacket(reply, body, user);
      case 'track':
        return handleTrack(reply, body);
      default:
        return reply
          .status(400)
          .send({ error: `Unknown or missing action: ${action ?? '(none)'}` });
    }
  });
}

// ── Operation: pickup-points ──────────────────────────────────────────────
// Mirrors GET /pickup-points. Client contract: { country }. Optional
// latitude/longitude/maxResults/type are honored if present (normalized from
// the client's camelCase to the coordinate/limit inputs the operation reads).

function handlePickupPoints(reply: FastifyReply, body: Record<string, unknown>): Promise<FastifyReply> {
  const country = asString(body.country)?.toLowerCase() ?? 'cz';
  const lat = asNumber(body.latitude);
  const lng = asNumber(body.longitude);
  const limit = Math.min(asNumber(body.maxResults) ?? 50, 200);
  const typeFilter = asString(body.type) as 'branch' | 'zbox' | undefined;

  return getBranches().then((all) => {
    let branches = all.filter((b) => b.country === country);
    if (typeFilter) {
      branches = branches.filter((b) => b.type === typeFilter);
    }

    if (lat !== undefined && lng !== undefined && !isNaN(lat) && !isNaN(lng)) {
      const sorted = sortByDistance(branches, lat, lng).slice(0, limit);
      return reply.send({ points: sorted, total: sorted.length });
    }

    return reply.send({ points: branches.slice(0, limit), total: branches.length });
  });
}

// ── Operation: available-methods ──────────────────────────────────────────
// Mirrors GET /available-methods. Client sends (verified in all 4 web hooks —
// useAvailableShippingMethods.ts is the canonical caller; useCheckout.ts,
// useCheckoutData.ts, useAdminShipments.ts do not call this action):
//   { country, currency, latitude, longitude, maxResults, orderSubtotal,
//     postalCode, weightGrams }.
//
// FIELD-NAME MAPPING (order total → shipping cost calc):
//   client `orderSubtotal` (number)  →  calculateShippingCost(orderTotal)
// The web clients send camelCase `orderSubtotal`; they do NOT send `order_total`.
// (The legacy REST GET /available-methods reads the `order_total` QUERY param,
// but no client invokes that surface — they all POST to /packeta-api.) Reading
// `orderSubtotal` here is what keeps checkout from a silent wrong-price 200.
// Remaining client fields are accepted but unused, matching the REST operation.

async function handleAvailableMethods(reply: FastifyReply, body: Record<string, unknown>): Promise<FastifyReply> {
  const country = asString(body.country)?.toLowerCase() ?? 'cz';
  const orderTotal = asNumber(body.orderSubtotal) ?? 0;

  const [branches, carriers] = await Promise.all([getBranches(), getCarriers()]);

  const filteredBranches = branches.filter((b) => b.country === country);
  const filteredCarriers = carriers.filter((c) => c.country === country);

  const shippingCost = calculateShippingCost(orderTotal);
  const currency = await resolveBaseCurrency();

  return reply.send({
    pickup_points: {
      branches: filteredBranches.filter((b) => b.type === 'branch').length,
      zboxes: filteredBranches.filter((b) => b.type === 'zbox').length,
    },
    carriers: filteredCarriers.map((c) => ({
      id: c.id,
      name: c.name,
      max_weight_kg: c.maxWeight,
      pickup_points: c.pickupPoints,
    })),
    shipping_cost: shippingCost,
    free_shipping_from: shippingCost === 0 ? orderTotal : undefined,
    currency,
  });
}

// ── Operation: create-packet ──────────────────────────────────────────────
// Mirrors POST /create-packet. Client sends
// { orderId, recipient: { name, email, phone, street, city, zip, country },
//   weight, value, branchId, cod?, note? }.
//
// NORMALIZATION:
//  - orderId            -> order_id
//  - branchId           -> recipient.addressId (Packeta pickup-point id)
//  - recipient.name     -> recipient.name + recipient.surname, by splitting on
//                          the LAST run of whitespace: everything before it is
//                          the given name(s), the final token is the surname.
//  - cod                -> <cod> (cash-on-delivery amount; falsy/0 omitted)
//  - note               -> <note>
// cod/note pass through verbatim to buildPacketXml (same field names as the REST
// sibling's CreatePacketBody); dropping them silently loses COD on checkout.
// The underlying operation requires order_id, recipient.name AND
// recipient.surname; a name with no whitespace yields an empty surname and is
// rejected with 400, preserving the existing validation.

async function handleCreatePacket(
  reply: FastifyReply,
  body: Record<string, unknown>,
  user: VerifiedUser,
): Promise<FastifyReply> {
  const orderId = asString(body.orderId);
  const rawRecipient = (body.recipient ?? {}) as Record<string, unknown>;
  const branchId = body.branchId;

  const { name, surname } = splitRecipientName(asString(rawRecipient.name) ?? '');

  if (!orderId || !name || !surname) {
    return reply
      .status(400)
      .send({ error: 'order_id and recipient name/surname are required' });
  }

  const recipient: PacketRecipient = {
    name,
    surname,
    email: asString(rawRecipient.email) ?? '',
    phone: asString(rawRecipient.phone) ?? '',
    addressId: branchId === undefined || branchId === null ? undefined : String(branchId),
    street: asString(rawRecipient.street),
    city: asString(rawRecipient.city),
    zip: asString(rawRecipient.zip),
    country: asString(rawRecipient.country),
  };

  const xml = buildPacketXml({
    order_id: orderId,
    recipient,
    weight: asNumber(body.weight) ?? 0,
    value: asNumber(body.value) ?? 0,
    cod: asNumber(body.cod),
    note: asString(body.note),
  });

  const res = await ssrfGuard.safeFetch(config.packetaApiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: xml,
    signal: AbortSignal.timeout(15_000),
  });

  const responseText = await res.text();

  if (!res.ok) {
    return reply.status(502).send({ error: 'Packeta API error', detail: responseText.slice(0, 200) });
  }

  const packetIdMatch = responseText.match(/<id>(\d+)<\/id>/);
  const barcodeMatch = responseText.match(/<barcode>([^<]+)<\/barcode>/);
  const packetId = packetIdMatch?.[1];
  const barcode = barcodeMatch?.[1];

  if (!packetId) {
    const errorMatch = responseText.match(/<fault>([^<]+)<\/fault>/);
    return reply.status(422).send({
      error: 'Packeta rejected the packet',
      detail: errorMatch?.[1] ?? 'Unknown error',
    });
  }

  await rpcService('create_shipment_record', {
    p_barcode: barcode ?? null,
    p_carrier: 'packeta',
    p_external_id: packetId,
    p_order_id: orderId,
    p_status: 'created',
    p_user_id: user.userId,
  }).catch(() => { /* non-critical audit */ });

  return reply.send({
    packet_id: packetId,
    barcode: barcode ?? null,
    status: 'created',
  });
}

// ── Operation: track ──────────────────────────────────────────────────────
// Mirrors GET /track/:packetId. Client sends { packetId } in the body; it is
// normalized to the string the path-param operation validates (^\d+$).

async function handleTrack(reply: FastifyReply, body: Record<string, unknown>): Promise<FastifyReply> {
  const packetId = body.packetId === undefined || body.packetId === null ? '' : String(body.packetId);
  if (!packetId || !/^\d+$/.test(packetId)) {
    return reply.status(400).send({ error: 'Invalid packet ID' });
  }

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<packetTracking>
  <apiPassword>${config.packetaApiKey}</apiPassword>
  <packetId>${packetId}</packetId>
</packetTracking>`;

  const res = await ssrfGuard.safeFetch(config.packetaApiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: xml,
    signal: AbortSignal.timeout(10_000),
  });

  const responseText = await res.text();

  if (!res.ok) {
    return reply.status(502).send({ error: 'Packeta tracking API error' });
  }

  const records = parseTrackingXml(responseText);

  return reply.send({ packet_id: packetId, tracking: records });
}

// ── Normalization / XML helpers ───────────────────────────────────────────

/**
 * Split a full name into given name(s) + surname on the LAST whitespace run.
 * "John Doe Smith" -> { name: "John Doe", surname: "Smith" }.
 * A single token (no whitespace) yields an empty surname so the caller can
 * reject it, matching the REST operation's name/surname requirement.
 */
export function splitRecipientName(fullName: string): { name: string; surname: string } {
  const trimmed = fullName.trim().replace(/\s+/g, ' ');
  if (!trimmed) return { name: '', surname: '' };
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace === -1) return { name: trimmed, surname: '' };
  return {
    name: trimmed.slice(0, lastSpace),
    surname: trimmed.slice(lastSpace + 1),
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}
