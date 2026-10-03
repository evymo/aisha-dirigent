import { config } from './config.js';

interface SetupKeyCreateResponse {
  id: string;
  key: string;
}

interface NetBirdGroup {
  id: string;
  name: string;
}

interface PeerResponse {
  id: string;
}

interface TokenCache {
  accessToken: string;
  expiresAtMs: number;
}

let tokenCache: TokenCache | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSetupKeyResponse(value: unknown): SetupKeyCreateResponse {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.key !== 'string') {
    throw new Error('NetBird setup-key response did not match expected shape');
  }
  return { id: value.id, key: value.key };
}

function parseGroupsResponse(value: unknown): NetBirdGroup[] {
  if (!Array.isArray(value)) {
    throw new Error('NetBird groups response did not match expected shape');
  }
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string') {
      return [];
    }
    return [{ id: item.id, name: item.name }];
  });
}

function parsePeersResponse(value: unknown): PeerResponse[] {
  if (!Array.isArray(value)) {
    throw new Error('NetBird peers response did not match expected shape');
  }
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string') {
      return [];
    }
    return [{ id: item.id }];
  });
}

function parseTokenResponse(value: unknown): { accessToken: string; expiresIn: number } {
  if (!isRecord(value) || typeof value.access_token !== 'string') {
    throw new Error('Keycloak token response did not include access_token');
  }
  return {
    accessToken: value.access_token,
    expiresIn: typeof value.expires_in === 'number' ? value.expires_in : 300,
  };
}

async function getKeycloakAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAtMs > now + 30_000) {
    return tokenCache.accessToken;
  }

  if (!config.netbirdKeycloakClientSecret) {
    throw new Error('NETBIRD_KEYCLOAK_CLIENT_SECRET is required for NetBird Bearer auth');
  }

  const tokenUrl = `${config.keycloakUrl.replace(/\/+$/, '')}/realms/${config.keycloakRealm}/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.netbirdKeycloakClientId,
    client_secret: config.netbirdKeycloakClientSecret,
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const responseBody = await res.text().catch(() => '');
    throw new Error(`Keycloak token request failed => ${res.status}: ${responseBody.slice(0, 200)}`);
  }

  const token = parseTokenResponse(await res.json());
  tokenCache = {
    accessToken: token.accessToken,
    expiresAtMs: now + token.expiresIn * 1000,
  };
  return token.accessToken;
}

async function getAuthorizationHeader(): Promise<string> {
  if (config.netbirdAuthScheme === 'Token') {
    if (!config.netbirdApiToken) {
      throw new Error('NETBIRD_API_TOKEN is required for NetBird Token auth');
    }
    return `Token ${config.netbirdApiToken}`;
  }

  if (config.netbirdKeycloakClientSecret) {
    return `Bearer ${await getKeycloakAccessToken()}`;
  }
  if (config.netbirdApiToken) {
    return `Bearer ${config.netbirdApiToken}`;
  }
  throw new Error('NetBird Bearer auth requires Keycloak client credentials or NETBIRD_API_TOKEN');
}

async function netbirdFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!config.netbirdApiUrl) {
    throw new Error('NETBIRD_API_URL is required when NetBird is enabled');
  }

  const headers = new Headers(init.headers);
  headers.set('Authorization', await getAuthorizationHeader());
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${config.netbirdApiUrl}${path}`, {
    ...init,
    headers,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`NetBird API ${init.method ?? 'GET'} ${path} => ${res.status}: ${body.slice(0, 200)}`);
  }
  return res;
}

async function resolveSandboxGroupId(): Promise<string> {
  const res = await netbirdFetch('/api/groups', { method: 'GET' });
  const groups = parseGroupsResponse(await res.json());
  const group = groups.find((candidate) =>
    candidate.id === config.netbirdSandboxGroup || candidate.name === config.netbirdSandboxGroup,
  );
  if (!group) {
    throw new Error(`NetBird sandbox group not found: ${config.netbirdSandboxGroup}`);
  }
  return group.id;
}

export async function createEphemeralKey(runId: string): Promise<{ setupKey: string; peerId: string }> {
  const sandboxGroupId = await resolveSandboxGroupId();
  const res = await netbirdFetch('/api/setup-keys', {
    method: 'POST',
    body: JSON.stringify({
      name: `sandbox-run-${runId}`,
      type: 'one-off',
      auto_groups: [sandboxGroupId],
      expires_in: 600, // 10 minutes — revoked immediately after spawn anyway
    }),
  });
  const key = parseSetupKeyResponse(await res.json());

  // The peer is not yet registered (agent hasn't connected), return key + temp id
  // We'll track peerId after the container reports in; for now return key.id as placeholder.
  return { setupKey: key.key, peerId: key.id };
}

export async function revokePeer(peerId: string): Promise<void> {
  // Look up peer by setup-key id pattern to find actual peer id
  // If the key was used, the peer will have registered with name `sandbox-run-{runId}`
  try {
    const peersRes = await netbirdFetch('/api/peers', { method: 'GET' });
    const peers = parsePeersResponse(await peersRes.json());
    for (const peer of peers) {
      if (peer.id === peerId) {
        await netbirdFetch(`/api/peers/${peer.id}`, { method: 'DELETE' });
        return;
      }
    }
    // Peer may not have connected yet — revoke setup key instead
    await netbirdFetch(`/api/setup-keys/${peerId}`, {
      method: 'PUT',
      body: JSON.stringify({ revoked: true }),
    });
  } catch {
    // Best-effort — container is already stopped, peer will expire via key TTL
  }
}
