import { importPKCS8, SignJWT } from 'jose';
import { config } from '../config.js';
import { rpcService } from '../postgrest.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TokenCacheEntry {
  token: string;
  expiresAt: number;
}

interface AppSecrets {
  appId: string;
  privateKey: string;
}

// ---------------------------------------------------------------------------
// Token cache (in-memory, per-installation)
// ---------------------------------------------------------------------------

const tokenCache = new Map<number, TokenCacheEntry>();

function getCachedToken(installationId: number): string | null {
  const entry = tokenCache.get(installationId);
  if (!entry) return null;
  // 60s safety margin
  if (Date.now() >= entry.expiresAt - 60_000) {
    tokenCache.delete(installationId);
    return null;
  }
  return entry.token;
}

function setCachedToken(installationId: number, token: string, expiresAt: string): void {
  tokenCache.set(installationId, {
    token,
    expiresAt: new Date(expiresAt).getTime(),
  });
}

/** Clear entire token cache (for testing). */
export function clearTokenCache(): void {
  tokenCache.clear();
}

// ---------------------------------------------------------------------------
// Secrets loading
// ---------------------------------------------------------------------------

let _cachedSecrets: AppSecrets | null = null;

/** Load GitHub App secrets from DB (vault/app_secrets) or env. */
async function loadSecrets(): Promise<AppSecrets> {
  if (_cachedSecrets) return _cachedSecrets;

  // 1. Try vault via RPC
  try {
    const data = await rpcService<Array<{ decrypted_secret: string }>>('get_github_app_secrets_from_vault');
    if (data?.[0]?.decrypted_secret) {
      const parsed = JSON.parse(data[0].decrypted_secret) as { app_id?: string; private_key?: string };
      if (parsed.app_id && parsed.private_key) {
        _cachedSecrets = { appId: parsed.app_id, privateKey: parsed.private_key };
        return _cachedSecrets;
      }
    }
  } catch {
    // vault not available — try next
  }

  // 2. Try app_secrets batch RPC
  try {
    const data = await rpcService<Array<{ key: string; value: string }>>('get_app_secrets_batch', {
      p_keys: ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY'],
    });
    if (Array.isArray(data) && data.length >= 2) {
      const map = Object.fromEntries(data.map((r) => [r.key, r.value]));
      if (map.GITHUB_APP_ID && map.GITHUB_APP_PRIVATE_KEY) {
        _cachedSecrets = { appId: map.GITHUB_APP_ID, privateKey: map.GITHUB_APP_PRIVATE_KEY };
        return _cachedSecrets;
      }
    }
  } catch {
    // fallback to env
  }

  // 3. Env fallback
  const appId = config.githubAppId;
  const privateKey = config.githubAppPrivateKey;
  if (!appId || !privateKey) {
    throw new Error('GitHub App secrets not found in vault, app_secrets, or environment');
  }

  _cachedSecrets = { appId, privateKey };
  return _cachedSecrets;
}

// ---------------------------------------------------------------------------
// GitHub App JWT creation
// ---------------------------------------------------------------------------

/** Create a short-lived GitHub App JWT (RS256, 10min). */
async function createAppJwt(secrets: AppSecrets): Promise<string> {
  // Handle escaped newlines
  const pem = secrets.privateKey.replace(/\\n/g, '\n');
  const key = await importPKCS8(pem, 'RS256');

  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(secrets.appId)
    .setIssuedAt(now - 60) // clock skew tolerance
    .setExpirationTime(now + 600)
    .sign(key);
}

// ---------------------------------------------------------------------------
// Installation token exchange
// ---------------------------------------------------------------------------

const GITHUB_API = 'https://api.github.com';

/**
 * Get a GitHub installation access token.
 * Uses cache when possible, otherwise exchanges App JWT for installation token.
 */
export async function getInstallationToken(installationId: number): Promise<string> {
  // 1. Check cache
  const cached = getCachedToken(installationId);
  if (cached) return cached;

  // 2. Load secrets
  const secrets = await loadSecrets();

  // 3. Create App JWT
  const appJwt = await createAppJwt(secrets);

  // 4. Exchange for installation token
  const res = await fetch(
    `${GITHUB_API}/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${appJwt}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub installation token exchange failed (${res.status}): ${body}`);
  }

  const data = await res.json() as { token: string; expires_at: string };

  // 5. Cache
  setCachedToken(installationId, data.token, data.expires_at);

  return data.token;
}
