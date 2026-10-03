// Main router for self-hosted Supabase Edge Runtime.
//
// This file is required when edge-runtime is started with:
//   edge-runtime start --main-service /home/deno/functions/main
//
// It dispatches requests to individual functions under:
//   /home/deno/functions/<function-name>/index.ts
//
// SECURITY NOTE:
// - Some setups validate JWT at the gateway (Kong) already.
// - This main service supports optional JWT verification via env VERIFY_JWT.

// Deno Edge Runtime ambient declarations — these globals are injected by the runtime.
declare const Deno: {
  env: { get(key: string): string | undefined; toObject(): Record<string, string> };
};
declare const EdgeRuntime: {
  userWorkers: {
    create(opts: {
      servicePath: string;
      memoryLimitMb: number;
      workerTimeoutMs: number;
      noModuleCache: boolean;
      importMapPath: string | null;
      envVars: [string, string][];
    }): Promise<{ fetch(req: Request): Promise<Response> }>;
  };
};

import { serve, jose } from "../_shared/deps.ts";

const JWT_SECRET = Deno.env.get("JWT_SECRET") ?? "";
const VERIFY_JWT = (Deno.env.get("VERIFY_JWT") ?? "false") === "true";
const remoteJwksCache = new Map<string, ReturnType<typeof jose.createRemoteJWKSet>>();

/** Allowed external JWT issuers — prevents SSRF via crafted iss claim. */
const ALLOWED_ISSUERS = new Set(
  (Deno.env.get("ALLOWED_JWT_ISSUERS") ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean),
);

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function getAuthToken(req: Request): string {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) throw new Error("Missing authorization header");

  const [bearer, token] = authHeader.split(" ");
  if (bearer !== "Bearer" || !token) {
    throw new Error("Auth header is not 'Bearer {token}'");
  }

  return token;
}

async function verifyJwt(token: string): Promise<boolean> {
  try {
    const header = jose.decodeProtectedHeader(token);
    const claims = jose.decodeJwt(token);
    const issuer = typeof claims.iss === "string" ? claims.iss.replace(/\/$/, "") : undefined;

    if (issuer && header.alg && !header.alg.startsWith("HS") && ALLOWED_ISSUERS.has(issuer)) {
      let jwks = remoteJwksCache.get(issuer);
      if (!jwks) {
        jwks = jose.createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
        remoteJwksCache.set(issuer, jwks);
      }

      await jose.jwtVerify(token, jwks, { issuer });
      return true;
    }

    if (!JWT_SECRET) return false;

    const encoder = new TextEncoder();
    const secretKey = encoder.encode(JWT_SECRET);
    await jose.jwtVerify(token, secretKey, issuer ? { issuer } : undefined);
    return true;
  } catch {
    return false;
  }
}

serve(async (req: Request) => {
  if (req.method !== "OPTIONS" && VERIFY_JWT) {
    try {
      const token = getAuthToken(req);
      const ok = await verifyJwt(token);
      if (!ok) return json({ msg: "Invalid JWT" }, 401);
    } catch (e) {
      return json({ msg: String(e) }, 401);
    }
  }

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/");
  const serviceName = pathParts[1];

  if (!serviceName) {
    return json({ msg: "missing function name in request" }, 400);
  }

  const servicePath = `/home/deno/functions/${serviceName}`;

  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath,
      memoryLimitMb: 150,
      workerTimeoutMs: 60_000,
      noModuleCache: false,
      importMapPath: null,
      envVars: Object.entries(Deno.env.toObject()),
    });

    return await worker.fetch(req);
  } catch (e) {
    return json({ msg: String(e) }, 500);
  }
});
