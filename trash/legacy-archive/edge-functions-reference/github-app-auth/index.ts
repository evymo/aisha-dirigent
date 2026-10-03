/**
 * Edge Function: github-app-auth
 *
 * GitHub App JWT signing + installation access token exchange.
 * Provides a single endpoint for all AISHA services to get
 * short-lived installation tokens for GitHub API operations.
 *
 * Flow:
 *   1. RS256 JWT signed with App private key → GitHub /app endpoint
 *   2. JWT exchanged for installation token → GitHub /app/installations/:id/access_tokens
 *   3. Token cached in-memory with 50min TTL (GitHub tokens expire in 60min)
 *
 * Auth: service_role key required (no public access)
 *
 * Environment (from app_secrets table):
 *   - GITHUB_APP_ID
 *   - GITHUB_APP_PRIVATE_KEY (PEM format)
 *
 * @module
 */

import { serve, createClient } from "../_shared/deps.ts";
import { preflightResponse } from "../_shared/cors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CachedToken {
  token: string;
  expiresAt: number; // Unix ms
  permissions: Record<string, string>;
}

interface InstallationTokenRequest {
  installation_id: number;
  /** Optional: restrict token to specific repos */
  repository_ids?: number[];
  /** Optional: restrict token permissions (subset of app permissions) */
  permissions?: Record<string, string>;
}

interface InstallationTokenResponse {
  token: string;
  expires_at: string;
  permissions: Record<string, string>;
  repository_selection?: string;
}

// ---------------------------------------------------------------------------
// In-memory token cache (per isolate)
// ---------------------------------------------------------------------------

const tokenCache = new Map<number, CachedToken>();
const CACHE_TTL_MS = 50 * 60 * 1000; // 50 min (tokens valid 60 min)

function getCachedToken(installationId: number): string | null {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }
  tokenCache.delete(installationId);
  return null;
}

function setCachedToken(installationId: number, token: string, permissions: Record<string, string>): void {
  tokenCache.set(installationId, {
    token,
    expiresAt: Date.now() + CACHE_TTL_MS,
    permissions,
  });
  // Prune expired entries (limit cache size)
  if (tokenCache.size > 100) {
    const now = Date.now();
    for (const [key, val] of tokenCache) {
      if (val.expiresAt <= now) tokenCache.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// JWT creation (RS256)
// ---------------------------------------------------------------------------

/** Import PEM private key for RS256 signing */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem
    .replace(/-----BEGIN RSA PRIVATE KEY-----/, "")
    .replace(/-----END RSA PRIVATE KEY-----/, "")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");

  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  // Try PKCS8 first (BEGIN PRIVATE KEY), fallback to PKCS1 via manual wrapping
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      binaryDer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch (pkcs8Err) {
    console.warn("PKCS8 import failed, trying PKCS1 wrapping:", pkcs8Err);
    // PKCS1 format (BEGIN RSA PRIVATE KEY) — wrap in PKCS8 envelope
    // This is common for GitHub-generated .pem files
    const pkcs8Header = new Uint8Array([
      0x30, 0x82, // SEQUENCE
      ...new Uint8Array([(binaryDer.length + 26) >> 8, (binaryDer.length + 26) & 0xff]),
      0x02, 0x01, 0x00, // INTEGER 0
      0x30, 0x0d, // SEQUENCE
      0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, // OID rsaEncryption
      0x05, 0x00, // NULL
      0x04, 0x82, // OCTET STRING
      ...new Uint8Array([(binaryDer.length) >> 8, (binaryDer.length) & 0xff]),
    ]);
    const pkcs8 = new Uint8Array(pkcs8Header.length + binaryDer.length);
    pkcs8.set(pkcs8Header, 0);
    pkcs8.set(binaryDer, pkcs8Header.length);

    return await crypto.subtle.importKey(
      "pkcs8",
      pkcs8,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  }
}

/** Create GitHub App JWT (valid for 10 minutes) */
async function createAppJwt(appId: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: appId,
    iat: now - 60, // 60s clock skew tolerance
    exp: now + 600, // 10 min max per GitHub docs
  };

  const key = await importPrivateKey(privateKeyPem);

  const encoder = new TextEncoder();
  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(signingInput),
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${signingInput}.${sigB64}`;
}

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------

const GITHUB_API = "https://api.github.com";

/** Exchange App JWT for installation access token */
async function getInstallationToken(
  appJwt: string,
  req: InstallationTokenRequest,
): Promise<InstallationTokenResponse> {
  const body: Record<string, unknown> = {};
  if (req.repository_ids?.length) body.repository_ids = req.repository_ids;
  if (req.permissions && Object.keys(req.permissions).length > 0) body.permissions = req.permissions;

  const response = await fetch(
    `${GITHUB_API}/app/installations/${req.installation_id}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GitHub token exchange failed (${response.status}): ${errorBody}`);
  }

  return response.json() as Promise<InstallationTokenResponse>;
}

// ---------------------------------------------------------------------------
// Secrets loader
// ---------------------------------------------------------------------------

let cachedSecrets: { appId: string; privateKey: string } | null = null;

async function loadSecrets(): Promise<{ appId: string; privateKey: string }> {
  if (cachedSecrets) return cachedSecrets;

  // Try env vars first (for local dev)
  const envAppId = Deno.env.get("GITHUB_APP_ID");
  const envKey = Deno.env.get("GITHUB_APP_PRIVATE_KEY");
  if (envAppId && envKey) {
    cachedSecrets = { appId: envAppId, privateKey: envKey };
    return cachedSecrets;
  }

  // Load from Supabase Vault (preferred) → falls back to app_secrets
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("API_EXTERNAL_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Try vault-aware helper first (vault → app_secrets fallback)
  const { data: vaultData, error: vaultError } = await supabase
    .rpc("get_github_app_secrets_from_vault");

  if (!vaultError && vaultData && vaultData.source !== "not_found") {
    const appId = vaultData.app_id as string;
    const privateKey = vaultData.private_key as string;
    if (appId && privateKey) {
      cachedSecrets = { appId, privateKey };
      return cachedSecrets;
    }
  }

  // Legacy fallback: get_app_secrets_batch (will be deprecated)
  const { data, error } = await supabase
    .rpc("get_app_secrets_batch", { p_keys: ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY"] });

  if (error || !data) {
    throw new Error(`Failed to load GitHub App secrets: ${error?.message ?? vaultError?.message ?? "no data"}`);
  }

  const secrets = data as Array<{ key: string; value: string }>;
  const appId = secrets.find((s: { key: string }) => s.key === "GITHUB_APP_ID")?.value;
  const privateKey = secrets.find((s: { key: string }) => s.key === "GITHUB_APP_PRIVATE_KEY")?.value;

  if (!appId || !privateKey) {
    throw new Error("GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY not found in vault or app_secrets");
  }

  cachedSecrets = { appId, privateKey };
  return cachedSecrets;
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function validateServiceRole(req: Request): boolean {
  const authHeader = req.headers.get("Authorization");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authHeader || !serviceKey) return false;

  const token = authHeader.replace(/^Bearer\s+/i, "");
  return token === serviceKey;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return preflightResponse(req, Deno.env.get("ALLOWED_ORIGINS"));
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  // Auth: service_role only
  if (!validateServiceRole(req)) {
    return errorResponse("Unauthorized: service_role required", 401);
  }

  let body: InstallationTokenRequest;
  try {
    body = await req.json() as InstallationTokenRequest;
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  if (!body.installation_id || typeof body.installation_id !== "number") {
    return errorResponse("installation_id (number) required", 400);
  }

  try {
    // Check cache first
    const cached = getCachedToken(body.installation_id);
    if (cached && !body.repository_ids && !body.permissions) {
      return new Response(
        JSON.stringify({ token: cached, cached: true }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Load secrets + create JWT
    const secrets = await loadSecrets();
    const appJwt = await createAppJwt(secrets.appId, secrets.privateKey);

    // Exchange for installation token
    const tokenResponse = await getInstallationToken(appJwt, body);

    // Cache (only for non-scoped requests)
    if (!body.repository_ids && !body.permissions) {
      setCachedToken(body.installation_id, tokenResponse.token, tokenResponse.permissions);
    }

    return new Response(
      JSON.stringify({
        token: tokenResponse.token,
        expires_at: tokenResponse.expires_at,
        permissions: tokenResponse.permissions,
        cached: false,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[github-app-auth] Installation access exchange failed:", message);
    return errorResponse(`Token exchange failed: ${message}`, 502);
  }
});
