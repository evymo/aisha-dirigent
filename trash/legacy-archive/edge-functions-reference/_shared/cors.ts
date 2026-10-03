type CorsHeaders = Record<string, string>;

const DEFAULT_ALLOW_HEADERS =
  "authorization, x-client-info, apikey, content-type";
const DEFAULT_ALLOW_METHODS = "POST, OPTIONS";

function parseAllowedOrigins(raw: string | undefined | null): string[] {
  const value = raw ?? "";
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function tryParseOrigin(origin: string): URL | null {
  try {
    return new URL(origin);
  } catch {
    return null;
  }
}

function isHostnameAllowedByEntry(params: {
  originHostname: string;
  entry: string;
}): boolean {
  const originHostname = params.originHostname.toLowerCase();
  const entry = params.entry.toLowerCase();

  // Wildcard subdomain match: *.example.com matches foo.example.com (not example.com).
  if (entry.startsWith("*.") && entry.length > 2) {
    const suffix = entry.slice(2);
    return originHostname.endsWith(`.${suffix}`);
  }

  // Host-only exact match: example.com
  if (!entry.includes("://") && !entry.includes("/") && !entry.includes(" ")) {
    return originHostname === entry;
  }

  return false;
}

export function isOriginAllowed(
  origin: string | null,
  allowedOriginsRaw: string | undefined | null,
): boolean {
  if (!origin) return true;
  const allowedOrigins = parseAllowedOrigins(allowedOriginsRaw);
  const allowAny = allowedOrigins.includes("*");
  if (allowAny || allowedOrigins.includes(origin)) return true;

  const parsedOrigin = tryParseOrigin(origin);
  if (!parsedOrigin) return false;

  const originHostname = parsedOrigin.hostname;
  return allowedOrigins.some((entry) => isHostnameAllowedByEntry({ originHostname, entry }));
}

function computeAllowOrigin(params: {
  origin: string | null;
  allowedOriginsRaw: string | undefined | null;
}): string {
  const { origin, allowedOriginsRaw } = params;

  // If Origin is not present (non-browser clients), allow by default.
  if (!origin) return "*";

  const isAllowed = isOriginAllowed(origin, allowedOriginsRaw);

  // Empty string signals "do not allow".
  return isAllowed ? origin : "";
}

export function buildCorsHeaders(
  req: Request,
  allowedOriginsRaw: string | undefined | null,
  overrides?: {
    allowHeaders?: string;
    allowMethods?: string;
  },
): CorsHeaders {
  const origin = req.headers.get("Origin");
  const allowOrigin = computeAllowOrigin({ origin, allowedOriginsRaw });

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": overrides?.allowHeaders ?? DEFAULT_ALLOW_HEADERS,
    "Access-Control-Allow-Methods": overrides?.allowMethods ?? DEFAULT_ALLOW_METHODS,
    Vary: "Origin",
  };
}

export function silentCorsDenyResponse(status = 403): Response {
  return new Response(null, { status, headers: { Vary: "Origin" } });
}

export function preflightResponse(
  req: Request,
  allowedOriginsRaw: string | undefined | null,
  overrides?: {
    allowHeaders?: string;
    allowMethods?: string;
  },
): Response {
  const corsHeaders = buildCorsHeaders(req, allowedOriginsRaw, overrides);

  // Silent deny for disallowed browser origins.
  const origin = req.headers.get("Origin");
  if (origin && corsHeaders["Access-Control-Allow-Origin"] === "") {
    return silentCorsDenyResponse(403);
  }

  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}
