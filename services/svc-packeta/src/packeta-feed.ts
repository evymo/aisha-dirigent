import { config } from './config.js';
import { resolveBaseCurrency } from './lib/currency.js';

// ── Types ──

export interface BranchPoint {
  id: string;
  name: string;
  nameStreet: string;
  city: string;
  zip: string;
  country: string;
  latitude: number;
  longitude: number;
  type: 'branch' | 'zbox';
  openingHours?: string;
  photo?: string;
  wheelchairAccessible?: boolean;
}

export interface Carrier {
  id: string;
  name: string;
  country: string;
  currency: string;
  maxWeight: number;
  pickupPoints: boolean;
}

// ── In-memory feed cache ──

let branchCache: BranchPoint[] = [];
let branchCacheTimestamp = 0;

let carrierCache: Carrier[] = [];
let carrierCacheTimestamp = 0;

/** Fetch Packeta branch feed v5 (XML parsed to JSON) */
export async function getBranches(): Promise<BranchPoint[]> {
  const now = Date.now();
  if (branchCache.length > 0 && now - branchCacheTimestamp < config.branchFeedTtl) {
    return branchCache;
  }

  const feedUrl = config.packetaXmlApiUrl.replace('%API_KEY%', config.packetaApiKey);
  const res = await fetch(feedUrl, { signal: AbortSignal.timeout(30_000) });

  if (!res.ok) {
    throw new Error(`Packeta branch feed failed: ${res.status}`);
  }

  const xml = await res.text();
  branchCache = parseBranchXml(xml);
  branchCacheTimestamp = now;
  return branchCache;
}

/** Parse Packeta XML branch feed into structured data */
function parseBranchXml(xml: string): BranchPoint[] {
  const result: BranchPoint[] = [];
  const branchRegex = /<branch>([\s\S]*?)<\/branch>/g;
  let match: RegExpExecArray | null;

  while ((match = branchRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag: string): string => {
      // eslint-disable-next-line security/detect-non-literal-regexp -- tag is a hardcoded literal at every call site (parseBranchXml)
      const m = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
      return m?.[1]?.trim() ?? '';
    };

    const lat = parseFloat(get('latitude'));
    const lng = parseFloat(get('longitude'));
    if (isNaN(lat) || isNaN(lng)) continue;

    const isZbox = get('place') === 'zbox' || get('isZbox') === '1';

    result.push({
      id: get('id'),
      name: get('name'),
      nameStreet: get('nameStreet') || get('street'),
      city: get('city'),
      zip: get('zip'),
      country: get('country')?.toLowerCase() ?? 'cz',
      latitude: lat,
      longitude: lng,
      type: isZbox ? 'zbox' : 'branch',
      openingHours: get('openingHours') || undefined,
      photo: get('photo') || undefined,
      wheelchairAccessible: get('wheelchairAccessible') === '1',
    });
  }

  return result;
}

/** Fetch carrier list from Packeta REST API */
export async function getCarriers(): Promise<Carrier[]> {
  const now = Date.now();
  if (carrierCache.length > 0 && now - carrierCacheTimestamp < config.carrierFeedTtl) {
    return carrierCache;
  }

  const res = await fetch(`${config.packetaApiUrl}/carrier`, {
    headers: {
      'Authorization': `Bearer ${config.packetaApiKey}`,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Packeta carrier API failed: ${res.status}`);
  }

  const data = await res.json() as { carriers?: Array<Record<string, unknown>> };
  const baseCurrency = await resolveBaseCurrency();
  carrierCache = (data.carriers ?? []).map((c) => ({
    id: String(c.id),
    name: String(c.name),
    country: String(c.country || 'cz'),
    currency: String(c.currency || baseCurrency),
    maxWeight: Number(c.maxWeight || 0),
    pickupPoints: Boolean(c.pickupPoints),
  }));
  carrierCacheTimestamp = now;
  return carrierCache;
}

// ── Geo helpers ──

const DEG_TO_RAD = Math.PI / 180;

/** Haversine distance in km */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Sort branches by distance from given coordinates */
export function sortByDistance(
  branches: BranchPoint[],
  lat: number,
  lng: number,
): Array<BranchPoint & { distanceKm: number }> {
  return branches
    .map((b) => ({ ...b, distanceKm: haversineKm(lat, lng, b.latitude, b.longitude) }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/** Calculate shipping cost with free shipping threshold */
export function calculateShippingCost(orderTotalCzk: number): number {
  return orderTotalCzk >= config.freeShippingThreshold ? 0 : config.defaultShippingCostCzk;
}
