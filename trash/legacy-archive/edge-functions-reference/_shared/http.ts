import { buildCorsHeaders } from "./cors.ts";

export function emptyResponse(
  req: Request,
  allowedOriginsRaw: string | undefined | null,
  status = 204,
): Response {
  const corsHeaders = buildCorsHeaders(req, allowedOriginsRaw);

  return new Response(null, {
    status,
    headers: corsHeaders,
  });
}

export function jsonResponse(
  req: Request,
  allowedOriginsRaw: string | undefined | null,
  body: Record<string, unknown>,
  status = 200,
): Response {
  const corsHeaders = buildCorsHeaders(req, allowedOriginsRaw);

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
