import { serve, createClient } from "../_shared/deps.ts";
import type { SupabaseClient } from "../_shared/deps.ts";
import { buildCorsHeaders, preflightResponse } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS, cleanupRateLimitStore } from "../_shared/rateLimiter.ts";
import { getPacketaConfig, type PacketaConfig } from "../_shared/packetaKeys.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreatePacketRequest {
  orderId: string;
  branchId?: number;
  carrierId?: number;
}

/** Packeta Feed v5 branch / Z-BOX point */
interface FeedPoint {
  id: number;
  name: string;
  nameStreet: string;
  place: string;
  street: string;
  city: string;
  zip: string;
  country: string;
  currency: string;
  status: number; // 1=active, 5=planned, …
  statusDescription: string;
  latitude: number;
  longitude: number;
  url: string;
  maxWeight: number;
  displayFrontend: boolean;
  wheelchairAccessible: boolean | null;
  creditCardPayment: boolean | null;
  directions: string;
  directionsCar: string;
  directionsPublic: string;
  photos: Array<{ thumbnail: string; normal: string }>;
  openingHours: {
    compactShort: string;
    compactLong: string;
    tableLong: string;
    regular: Record<string, string>;
    upcoming: Record<string, string>;
    exceptions: unknown[];
  };
  // Z-BOX specific
  type?: string; // "zbox"
  codAllowed?: boolean;
  hasKeypad?: boolean;
}

/** Packeta Feed v5 carrier */
interface FeedCarrier {
  id: number;
  name: string;
  available: boolean;
  pickupPoints: boolean;
  apiAllowed: boolean;
  separateHouseNumber: boolean;
  customsDeclarations: boolean;
  requiresEmail: boolean;
  requiresPhone: boolean;
  requiresSize: boolean;
  disallowsCod: boolean;
  country: string;
  currency: string;
  maxWeight: number;
}

/** Simplified point for frontend */
interface ShippingPoint {
  id: number;
  name: string;
  street: string;
  city: string;
  zip: string;
  country: string;
  latitude: number;
  longitude: number;
  distance?: number; // km from user
  openingHours?: string;
  photos: Array<{ thumbnail: string; normal: string }>;
  wheelchairAccessible: boolean;
  creditCardPayment: boolean;
  maxWeight: number;
  type: "branch" | "zbox";
  codAllowed?: boolean;
  hasKeypad?: boolean;
}

/** Carrier option for frontend */
interface ShippingCarrier {
  id: number;
  name: string;
  displayName: string;
  country: string;
  deliveryType: "HD" | "PP" | "Box";
  maxWeight: number;
  requiresEmail: boolean;
  requiresPhone: boolean;
  disallowsCod: boolean;
}

/** Full available-methods response */
interface AvailableMethodsResponse {
  pickupPoints: ShippingPoint[];
  zboxes: ShippingPoint[];
  carriers: ShippingCarrier[];
  carrierPickupPoints: ShippingPoint[];
  personalPickupAvailable: boolean;
  costs: Record<string, number>;
  freeShippingThreshold: number | null;
  totalBranchCount: number;
  totalZboxCount: number;
}

// ---------------------------------------------------------------------------
// Cache (in-memory, per Deno isolate)
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const feedCache = new Map<string, CacheEntry<unknown>>();

const CACHE_TTL = {
  branches: 15 * 60 * 1000,         // 15 min
  boxes: 15 * 60 * 1000,            // 15 min
  carriers: 60 * 60 * 1000,         // 1 hour
  carrierPoints: 4 * 60 * 60 * 1000, // 4 hours
} as const;

async function getCached<T>(
  key: string,
  ttl: number,
  fetchFn: () => Promise<T>,
): Promise<T> {
  const cached = feedCache.get(key) as CacheEntry<T> | undefined;
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data;
  }
  const data = await fetchFn();
  feedCache.set(key, { data, timestamp: Date.now() });
  return data;
}

// ---------------------------------------------------------------------------
// Packeta Feed v5 fetchers
// ---------------------------------------------------------------------------

const FEED_BASE = "https://pickup-point.api.packeta.com/v5";

async function fetchBranches(apiKey: string, country: string): Promise<FeedPoint[]> {
  const cc = country.toLowerCase();
  return getCached(`branches_${cc}`, CACHE_TTL.branches, async () => {
    const url = `${FEED_BASE}/${apiKey}/branch/json?lang=cs&country=${cc}`;
    if (!url.startsWith("https://")) throw new Error("SSRF Prevention");
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.error(`Packeta branch feed error: ${res.status}`);
      return [];
    }
    const json = await res.json() as { data?: Record<string, FeedPoint> };
    if (!json.data) return [];
    return Object.values(json.data).filter(
      (p) => p.status === 1 && p.displayFrontend,
    );
  });
}

async function fetchBoxes(apiKey: string, country: string): Promise<FeedPoint[]> {
  const cc = country.toLowerCase();
  return getCached(`boxes_${cc}`, CACHE_TTL.boxes, async () => {
    const url = `${FEED_BASE}/${apiKey}/box/json?lang=cs&country=${cc}`;
    if (!url.startsWith("https://")) throw new Error("SSRF Prevention");
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.error(`Packeta box feed error: ${res.status}`);
      return [];
    }
    const json = await res.json() as { data?: Record<string, FeedPoint> };
    if (!json.data) return [];
    return Object.values(json.data).filter(
      (p) => p.status === 1 && p.displayFrontend,
    );
  });
}

async function fetchCarriers(apiKey: string): Promise<FeedCarrier[]> {
  return getCached("carriers", CACHE_TTL.carriers, async () => {
    const url = `${FEED_BASE}/${apiKey}/carrier/json`;
    if (!url.startsWith("https://")) throw new Error("SSRF Prevention");
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.error(`Packeta carrier feed error: ${res.status}`);
      return [];
    }
    const json = await res.json() as { carriers?: FeedCarrier[] };
    return (json.carriers ?? []).filter((c) => c.available && c.apiAllowed);
  });
}

// ---------------------------------------------------------------------------
// Geo helpers
// ---------------------------------------------------------------------------

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Parse carrier name: "CZ Zásilkovna domů HD" → { country, displayName, deliveryType } */
function parseCarrierName(name: string): { country: string; displayName: string; deliveryType: "HD" | "PP" | "Box" } {
  const parts = name.split(" ");
  if (parts.length < 3) {
    return { country: parts[0] ?? "", displayName: name, deliveryType: "HD" };
  }
  const country = parts[0];
  const lastToken = parts[parts.length - 1];
  const deliveryType = (lastToken === "HD" || lastToken === "PP" || lastToken === "Box")
    ? lastToken as "HD" | "PP" | "Box"
    : "HD";
  const displayName = parts.slice(1, lastToken === "HD" || lastToken === "PP" || lastToken === "Box" ? -1 : undefined).join(" ");
  return { country, displayName, deliveryType };
}

function filterByPostalCode(points: FeedPoint[], postalCode: string): FeedPoint[] {
  const clean = postalCode.replace(/\s/g, "");
  if (clean.length < 2) return points;
  const prefix = clean.substring(0, 2);
  return points.filter((p) => p.zip.replace(/\s/g, "").startsWith(prefix));
}

function toShippingPoint(p: FeedPoint, userLat?: number, userLon?: number): ShippingPoint {
  const dist = (userLat != null && userLon != null && p.latitude && p.longitude)
    ? Math.round(haversineKm(userLat, userLon, p.latitude, p.longitude) * 10) / 10
    : undefined;
  return {
    id: p.id,
    name: p.name,
    street: p.street || p.nameStreet || "",
    city: p.city,
    zip: p.zip,
    country: p.country,
    latitude: p.latitude,
    longitude: p.longitude,
    distance: dist,
    openingHours: p.openingHours?.compactShort ?? "",
    photos: p.photos ?? [],
    wheelchairAccessible: p.wheelchairAccessible ?? false,
    creditCardPayment: p.creditCardPayment ?? false,
    maxWeight: p.maxWeight,
    type: p.type === "zbox" ? "zbox" : "branch",
    codAllowed: p.codAllowed,
    hasKeypad: p.hasKeypad,
  };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req, "*");

  if (req.method === "OPTIONS") {
    return preflightResponse(req, "*");
  }

  cleanupRateLimitStore();

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing authorization header" }, 401, corsHeaders);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    // Service-role client for reading secrets from Vault via edge_app_secrets.
    // The main `supabase` client overrides Authorization with the user JWT,
    // which makes PostgREST see `authenticated` role — but edge_app_secrets
    // is only granted to `service_role`. This client keeps the service-role
    // identity intact.
    const serviceRoleClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));

    if (userError || !user) {
      return jsonResponse({ error: "Invalid token" }, 401, corsHeaders);
    }

    const rateLimit = checkRateLimit(user.id, RATE_LIMITS.packeta);
    if (!rateLimit.allowed) {
      console.warn(`Rate limit exceeded for user ${user.id} on packeta-api`);
      return rateLimitResponse(rateLimit, corsHeaders);
    }

    const url = new URL(req.url);
    const pathAction = url.pathname.split("/").pop() || "";
    const contentType = req.headers.get("content-type") || "";
    let body: Record<string, unknown> | null = null;

    if (req.method !== "GET" && contentType.includes("application/json")) {
      try {
        body = await req.json();
      } catch (err) {
        console.warn("[packeta-api] declared JSON content-type but body did not parse, treating as empty:", err);
        body = null;
      }
    }

    const action = typeof body?.action === "string" ? body.action : pathAction;

    // Public actions (any authenticated user)
    if (action === "pickup-points" || action === "available-methods") {
      const packetaConfig = await getPacketaConfig(serviceRoleClient);
      if (!packetaConfig) {
        return jsonResponse({ error: "Packeta API not configured. Set keys in Admin > Settings." }, 500, corsHeaders);
      }

      if (action === "pickup-points") {
        const bodyCountry = typeof body?.country === "string" ? body.country : "";
        const country = bodyCountry || url.searchParams.get("country") || "cz";
        return await getPickupPoints(country, packetaConfig, corsHeaders);
      }

      if (action === "available-methods") {
        return await getAvailableMethods(body ?? {}, supabase, packetaConfig, corsHeaders);
      }
    }

    // Admin actions (require process_orders permission)
    const { data: hasPermission } = await supabase.rpc("has_permission", {
      p_permission_code: "process_orders",
      p_user_id: user.id,
    });

    if (!hasPermission) {
      return jsonResponse({ error: "Insufficient permissions" }, 403, corsHeaders);
    }

    const packetaConfig = await getPacketaConfig(serviceRoleClient);
    if (!packetaConfig) {
      return jsonResponse({ error: "Packeta API not configured. Set keys in Admin > Settings." }, 500, corsHeaders);
    }

    switch (action) {
      case "create-packet": {
        const payload = (body ?? {}) as CreatePacketRequest;
        const { orderId, branchId, carrierId } = payload;
        if (!orderId) {
          return jsonResponse({ error: "Order ID required" }, 400, corsHeaders);
        }
        const normalizedBranchId = typeof branchId === "number"
          ? branchId
          : branchId != null
            ? Number(branchId)
            : undefined;
        const normalizedCarrierId = typeof carrierId === "number"
          ? carrierId
          : carrierId != null
            ? Number(carrierId)
            : undefined;
        return await createPacket(supabase, orderId, normalizedBranchId, normalizedCarrierId, packetaConfig, corsHeaders);
      }
      case "track": {
        const packetId = url.searchParams.get("packetId");
        if (!packetId) {
          return jsonResponse({ error: "Packet ID required" }, 400, corsHeaders);
        }
        return await trackPacket(packetId, packetaConfig, corsHeaders);
      }
      default:
        return jsonResponse({ error: "Unknown action" }, 400, corsHeaders);
    }
  } catch (error) {
    console.error("Packeta API error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...buildCorsHeaders(req, "*"), "Content-Type": "application/json" } },
    );
  }
});

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function jsonResponse(data: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Action: available-methods (NEW — Smart Shipping)
// ---------------------------------------------------------------------------

async function getAvailableMethods(
  body: Record<string, unknown>,
  supabase: SupabaseClient,
  config: PacketaConfig,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const country = (typeof body.country === "string" ? body.country : "CZ").toUpperCase();
  const postalCode = typeof body.postalCode === "string" ? body.postalCode.trim() : "";
  const currency = typeof body.currency === "string" ? body.currency : "CZK";
  const weightGrams = typeof body.weightGrams === "number" ? body.weightGrams : 500;
  const orderSubtotal = typeof body.orderSubtotal === "number" ? body.orderSubtotal : 0;
  const userLat = typeof body.latitude === "number" ? body.latitude : undefined;
  const userLon = typeof body.longitude === "number" ? body.longitude : undefined;
  const maxResults = typeof body.maxResults === "number" ? Math.min(body.maxResults, 50) : 20;

  // Fetch feeds in parallel
  const [allBranches, allBoxes, allCarriers] = await Promise.all([
    fetchBranches(config.apiKey, country),
    fetchBoxes(config.apiKey, country),
    fetchCarriers(config.apiKey),
  ]);

  // Filter by postal code (if provided) or return unfiltered
  const filteredBranches = postalCode.length >= 2
    ? filterByPostalCode(allBranches, postalCode)
    : allBranches;

  const filteredBoxes = postalCode.length >= 2
    ? filterByPostalCode(allBoxes, postalCode)
    : allBoxes;

  // Convert to shipping points
  let pickupPoints = filteredBranches.map((p) => toShippingPoint(p, userLat, userLon));
  let zboxes = filteredBoxes.map((p) => toShippingPoint(p, userLat, userLon));

  // Sort by distance if GPS available, otherwise alphabetically
  if (userLat != null && userLon != null) {
    pickupPoints.sort((a, b) => (a.distance ?? 9999) - (b.distance ?? 9999));
    zboxes.sort((a, b) => (a.distance ?? 9999) - (b.distance ?? 9999));
  } else {
    pickupPoints.sort((a, b) => a.city.localeCompare(b.city, "cs"));
    zboxes.sort((a, b) => a.city.localeCompare(b.city, "cs"));
  }

  // Limit results
  pickupPoints = pickupPoints.slice(0, maxResults);
  zboxes = zboxes.slice(0, maxResults);

  // Filter carriers to this country + HD type
  const countryCarriers = allCarriers.filter((c) => {
    const parsed = parseCarrierName(c.name);
    return parsed.country === country && c.maxWeight * 1000 >= weightGrams;
  });

  const shippingCarriers: ShippingCarrier[] = countryCarriers.map((c) => {
    const parsed = parseCarrierName(c.name);
    return {
      id: c.id,
      name: c.name,
      displayName: parsed.displayName,
      country: parsed.country,
      deliveryType: parsed.deliveryType,
      maxWeight: c.maxWeight,
      requiresEmail: c.requiresEmail,
      requiresPhone: c.requiresPhone,
      disallowsCod: c.disallowsCod,
    };
  });

  // Fetch shipping costs for all 6 methods
  const methods = [
    "packeta_pickup",
    "packeta_zbox",
    "packeta_home",
    "carrier_pickup",
    "carrier_home",
    "personal_pickup",
  ] as const;

  const costResults = await Promise.all(
    methods.map(async (method) => {
      const { data, error } = await supabase.rpc("get_shipping_cost", {
        p_country: country,
        p_currency: currency,
        p_order_subtotal: orderSubtotal,
        p_shipping_method: method,
        p_weight_grams: weightGrams,
      });
      if (error) {
        console.error(`Shipping cost error for ${method}:`, error.message);
        return { method, cost: -2 }; // error
      }
      return { method, cost: Number(data ?? 0) };
    }),
  );

  const costs: Record<string, number> = {};
  for (const r of costResults) {
    costs[r.method] = Number.isFinite(r.cost) ? r.cost : 0;
  }

  // Free shipping threshold
  let freeShippingThreshold: number | null = null;
  try {
    const { data: ratesRaw } = await supabase
      .from("shipment_settings")
      .select("setting_value")
      .eq("setting_key", "shipping_rates")
      .single();
    if (ratesRaw?.setting_value) {
      const rates = JSON.parse(ratesRaw.setting_value as string);
      const thresholds = rates?.free_shipping_thresholds ?? {};
      const thresholdBase = thresholds[country] ?? thresholds.default ?? null;
      if (thresholdBase != null) {
        // Convert threshold to target currency
        if (currency !== (rates.base_currency ?? "CZK")) {
          const { data: converted } = await supabase.rpc("convert_currency_amount", {
            p_amount: thresholdBase,
            p_from_currency: rates.base_currency ?? "CZK",
            p_to_currency: currency,
          });
          freeShippingThreshold = Number(converted ?? thresholdBase);
        } else {
          freeShippingThreshold = thresholdBase;
        }
      }
    }
  } catch {
    // Non-critical, continue without threshold
  }

  const response: AvailableMethodsResponse = {
    pickupPoints,
    zboxes,
    carriers: shippingCarriers,
    carrierPickupPoints: [], // TODO: fetch carrier PUDOs when needed
    personalPickupAvailable: true,
    costs,
    freeShippingThreshold,
    totalBranchCount: filteredBranches.length,
    totalZboxCount: filteredBoxes.length,
  };

  return jsonResponse(response, 200, corsHeaders);
}

// ---------------------------------------------------------------------------
// Action: pickup-points (legacy — still used by existing code)
// ---------------------------------------------------------------------------

async function getPickupPoints(
  country: string,
  config: PacketaConfig,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  try {
    const branches = await fetchBranches(config.apiKey, country);

    const pickupPoints = branches.slice(0, 100).map((point) => ({
      id: point.id,
      name: point.name,
      street: point.street || "",
      city: point.city,
      zip: point.zip,
      country: point.country,
      openingHours: point.openingHours?.compactShort ?? "",
      gps: {
        lat: point.latitude || 0,
        lng: point.longitude || 0,
      },
      photos: point.photos || [],
    }));

    return jsonResponse(
      { pickupPoints, points: pickupPoints, total: branches.length },
      200,
      corsHeaders,
    );
  } catch (error) {
    console.error("Packeta pickup points error:", error);
    return jsonResponse(
      { error: "Failed to fetch pickup points", pickupPoints: [] },
      500,
      corsHeaders,
    );
  }
}

// ---------------------------------------------------------------------------
// Action: create-packet
// ---------------------------------------------------------------------------

async function createPacket(
  supabase: SupabaseClient,
  orderId: string,
  branchId: number | undefined,
  carrierId: number | undefined,
  config: PacketaConfig,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const { data: contextResult, error: orderError } = await supabase.rpc("edge_orders", {
    p_action: "get_packeta_context",
    p_payload: { order_id: orderId },
  });

  const context = (contextResult as {
    row?: {
      order?: {
        id: string;
        user_id: string;
        total: number;
        status: string;
        shipping_address: Record<string, unknown>;
        shipping_method?: string;
        packeta_packet_id?: string | null;
        packeta_branch_id?: number | null;
        carrier_id?: number | null;
      } | null;
      order_items?: Array<{ quantity: number; product_id: string }> | null;
    } | null;
  } | null)?.row ?? null;
  const order = context?.order ?? null;

  if (orderError || !order) {
    return jsonResponse({ error: "Order not found" }, 404, corsHeaders);
  }

  const orderItems = context?.order_items ?? [];

  const existingPacketId = (order as Record<string, unknown>).packeta_packet_id;
  if (existingPacketId) {
    return jsonResponse(
      { error: "Packet already created", packetId: existingPacketId },
      400,
      corsHeaders,
    );
  }

  if (order.status !== "paid") {
    return jsonResponse({ error: "Order must be paid first" }, 400, corsHeaders);
  }

  const shippingAddress = order.shipping_address as Record<string, unknown>;

  const totalWeight = (orderItems || []).reduce((sum: number, item: { quantity: number }) => {
    return sum + 500 * item.quantity;
  }, 0);

  // Determine addressId: branchId for PUDO/Z-BOX, carrierId for HD
  const effectiveBranchId = branchId ?? (order.packeta_branch_id ?? undefined);
  const effectiveCarrierId = carrierId ?? (order.carrier_id ?? undefined);
  const addressId = effectiveBranchId ?? effectiveCarrierId;

  const packetData = {
    packetAttributes: {
      number: orderId.substring(0, 24),
      name: shippingAddress.firstName as string,
      surname: shippingAddress.lastName as string,
      email: (shippingAddress.email as string) || "",
      phone: (shippingAddress.phone as string) || "",
      addressId: addressId,
      street: addressId ? undefined : (shippingAddress.address as string),
      city: addressId ? undefined : (shippingAddress.city as string),
      zip: addressId ? undefined : (shippingAddress.postalCode as string),
      country: ((shippingAddress.country as string) || "CZ").toLowerCase(),
      value: order.total,
      weight: totalWeight / 1000,
      eshop: config.senderId,
      cod: 0,
    },
  };

  const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<createPacket>
  <apiPassword>${config.apiPassword}</apiPassword>
  <packetAttributes>
    <number>${packetData.packetAttributes.number}</number>
    <name>${packetData.packetAttributes.name}</name>
    <surname>${packetData.packetAttributes.surname}</surname>
    <email>${packetData.packetAttributes.email}</email>
    <phone>${packetData.packetAttributes.phone}</phone>
    ${packetData.packetAttributes.addressId ? `<addressId>${packetData.packetAttributes.addressId}</addressId>` : ""}
    ${packetData.packetAttributes.street ? `<street>${packetData.packetAttributes.street}</street>` : ""}
    ${packetData.packetAttributes.city ? `<city>${packetData.packetAttributes.city}</city>` : ""}
    ${packetData.packetAttributes.zip ? `<zip>${packetData.packetAttributes.zip}</zip>` : ""}
    <country>${packetData.packetAttributes.country}</country>
    <value>${packetData.packetAttributes.value}</value>
    <weight>${packetData.packetAttributes.weight}</weight>
    <eshop>${packetData.packetAttributes.eshop}</eshop>
    <cod>${packetData.packetAttributes.cod}</cod>
  </packetAttributes>
</createPacket>`;

  const response = await fetch("https://www.zasilkovna.cz/api/rest", {
      signal: AbortSignal.timeout(15000),
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8" },
    body: xmlBody,
  });

  const xmlResult = await response.text();

  const statusMatch = xmlResult.match(/<status>([^<]+)<\/status>/);
  const idMatch = xmlResult.match(/<id>([^<]+)<\/id>/);
  const barcodeMatch = xmlResult.match(/<barcode>([^<]+)<\/barcode>/);
  const errorMatch =
    xmlResult.match(/<fault>([^<]+)<\/fault>/) ||
    xmlResult.match(/<message>([^<]+)<\/message>/);

  const result = {
    status: statusMatch?.[1] || "error",
    result: idMatch
      ? {
          id: idMatch[1],
          barcode: barcodeMatch?.[1] || "",
          labelUrl: `https://www.zasilkovna.cz/api/labels/${idMatch[1]}.pdf`,
        }
      : undefined,
    message: errorMatch?.[1],
  } as {
    status: string;
    result?: { id: string; barcode: string; labelUrl: string };
    message?: string;
  };

  if (result.status === "ok" && result.result?.id) {
    const trackingUrl = `https://tracking.packeta.com/cs/?id=${result.result.id}`;
    await supabase.rpc("edge_orders", {
      p_action: "update_order",
      p_payload: {
        order_id: orderId,
        packeta_barcode: result.result.barcode,
        packeta_branch_id: effectiveBranchId ?? order.packeta_branch_id ?? null,
        packeta_packet_id: result.result.id,
        status: "processing",
        tracking_url: trackingUrl,
      },
    });

    return jsonResponse(
      {
        success: true,
        packetId: result.result.id,
        barcode: result.result.barcode,
        labelUrl: result.result.labelUrl,
        trackingUrl,
      },
      200,
      corsHeaders,
    );
  } else {
    return jsonResponse(
      { error: result.message || "Failed to create packet", details: result },
      400,
      corsHeaders,
    );
  }
}

// ---------------------------------------------------------------------------
// Action: track
// ---------------------------------------------------------------------------

async function trackPacket(
  packetId: string,
  config: PacketaConfig,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const trackingUrl = `https://tracking.packeta.com/api/v1/packet/${packetId}`;

  try {
    const response = await fetch(trackingUrl, {
        signal: AbortSignal.timeout(15000),
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiPassword}`,
      },
    });

    if (!response.ok) {
      return jsonResponse(
        {
          packetId,
          trackingUrl: `https://tracking.packeta.com/cs/?id=${packetId}`,
          message: "Use tracking URL for detailed status",
        },
        200,
        corsHeaders,
      );
    }

    const result = await response.json();
    return jsonResponse(result, 200, corsHeaders);
  } catch (error) {
    console.error("Packeta tracking error:", error);
    return jsonResponse(
      {
        packetId,
        trackingUrl: `https://tracking.packeta.com/cs/?id=${packetId}`,
        error: "Could not fetch tracking data",
      },
      200,
      corsHeaders,
    );
  }
}
