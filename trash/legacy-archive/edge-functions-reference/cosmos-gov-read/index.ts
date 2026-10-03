/**
 * Edge Function: cosmos-gov-read
 *
 * Read-only proxy for Cosmos governance REST API.
 * Frontend calls this instead of hitting Cosmos node directly
 * (node is on private LAN, not exposed to internet).
 *
 * Supported paths (GET only):
 * - /cosmos/gov/v1/proposals
 * - /cosmos/gov/v1/proposals/:id
 * - /cosmos/bank/v1beta1/supply
 * - /cosmos/base/tendermint/v1beta1/node_info
 *
 * No authentication required (public governance data).
 */
import { serve } from "../_shared/deps.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";

const COSMOS_REST =
  Deno.env.get("COSMOS_REST_URL") ?? "http://cosmos-node:1317";

const ALLOWED_ORIGINS = Deno.env.get("ALLOWED_ORIGINS") ?? "*";

/** Whitelist of allowed Cosmos REST paths (prefix match). */
const ALLOWED_PREFIXES = [
  "/cosmos/gov/v1/proposals",
  "/cosmos/bank/v1beta1/supply",
  "/cosmos/base/tendermint/v1beta1/node_info",
  "/cosmos/staking/v1beta1/validators",
];

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req, ALLOWED_ORIGINS);

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const cosmosPath = url.pathname.replace(
    /^\/cosmos-gov-read/,
    "",
  );

  // Validate path against whitelist
  const isAllowed = ALLOWED_PREFIXES.some((prefix) =>
    cosmosPath.startsWith(prefix)
  );

  if (!isAllowed) {
    return new Response(JSON.stringify({ error: "Path not allowed" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const cosmosUrl = `${COSMOS_REST}${cosmosPath}${url.search}`;
    const res = await fetch(cosmosUrl, {
      signal: AbortSignal.timeout(10_000),
    });

    const body = await res.text();

    return new Response(body, {
      status: res.status,
      headers: {
        ...corsHeaders,
        "Content-Type": res.headers.get("Content-Type") ?? "application/json",
        "Cache-Control": "public, max-age=5",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cosmos node unreachable";
    return new Response(JSON.stringify({ error: message }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
