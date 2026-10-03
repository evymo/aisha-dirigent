import { config } from '../config.js';

/**
 * Shared Packeta (Zásilkovna) XML helpers.
 *
 * Single source of truth for building the `createPacket` request payload and
 * parsing the `packetTracking` response, imported by BOTH the REST routes
 * (create-packet.ts / track.ts) AND the unified dispatcher (packeta-api.ts).
 * Keeping one implementation guarantees the two surfaces emit identical XML
 * and extract identical tracking fields (DRY — no drift between surfaces).
 */

// ── create-packet payload ─────────────────────────────────────────────────

export interface PacketRecipient {
  name: string;
  surname: string;
  email: string;
  phone: string;
  addressId?: string; // Packeta pickup point ID
  street?: string;
  city?: string;
  zip?: string;
  country?: string;
}

export interface BuildPacketInput {
  order_id: string;
  recipient: PacketRecipient;
  weight: number;
  value: number;
  cod?: number; // Cash on delivery amount (falsy/0 → omitted)
  note?: string;
}

export function buildPacketXml(body: BuildPacketInput): string {
  const r = body.recipient;
  return `<?xml version="1.0" encoding="utf-8"?>
<createPacket>
  <apiPassword>${config.packetaApiKey}</apiPassword>
  <packetAttributes>
    <number>${escapeXml(body.order_id)}</number>
    <name>${escapeXml(r.name)}</name>
    <surname>${escapeXml(r.surname)}</surname>
    <email>${escapeXml(r.email)}</email>
    <phone>${escapeXml(r.phone)}</phone>
    ${r.addressId ? `<addressId>${escapeXml(r.addressId)}</addressId>` : ''}
    ${r.street ? `<street>${escapeXml(r.street)}</street>` : ''}
    ${r.city ? `<city>${escapeXml(r.city)}</city>` : ''}
    ${r.zip ? `<zip>${escapeXml(r.zip)}</zip>` : ''}
    <country>${escapeXml(r.country ?? 'cz')}</country>
    <weight>${body.weight}</weight>
    <value>${body.value}</value>
    ${body.cod ? `<cod>${body.cod}</cod>` : ''}
    ${body.note ? `<note>${escapeXml(body.note)}</note>` : ''}
  </packetAttributes>
</createPacket>`;
}

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── packetTracking parsing ────────────────────────────────────────────────

export interface TrackingRecord {
  dateTime: string;
  statusId: string;
  statusText: string;
  branchId?: string;
}

/**
 * Allowed tag names for Packeta XML feed extraction. Whitelist enforced to
 * prevent any caller-controlled string from reaching new RegExp().
 */
export const PACKETA_XML_TAGS = [
  'dateTime',
  'statusId',
  'statusName',
  'destination',
  'note',
] as const;
export type PacketaXmlTag = (typeof PACKETA_XML_TAGS)[number];

export function parseTrackingXml(xml: string): TrackingRecord[] {
  const result: TrackingRecord[] = [];
  const recordRegex = /<record>([\s\S]*?)<\/record>/g;
  let match: RegExpExecArray | null;

  while ((match = recordRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag: PacketaXmlTag): string => {
      if (!PACKETA_XML_TAGS.includes(tag)) {
        throw new Error(`Refusing to parse unknown XML tag: ${tag}`);
      }
      // eslint-disable-next-line security/detect-non-literal-regexp -- tag is allowlisted above
      const m = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
      return m?.[1]?.trim() ?? '';
    };

    result.push({
      dateTime: get('dateTime'),
      statusId: get('statusId'),
      statusText: get('statusName') || get('note'),
      branchId: get('destination') || undefined,
    });
  }

  return result;
}
