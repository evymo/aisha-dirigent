import type { VerifiedUser } from './auth.js';
import { rpcService } from './postgrest.js';
import { config } from './config.js';
import { createSsrfGuard, parseHostAllowlist } from '@aisha/security';

// OWASP A10 — every outbound Synapse admin/CS-API call goes through the SSRF
// guard. synapseAdminUrl is operator config (trust anchor), not user input; the
// localpart only ever appears in the request body, never in the host.
const SYNAPSE_HOST = (() => {
  try {
    return new URL(config.synapseAdminUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
})();
const ssrfGuard = createSsrfGuard({
  service: 'svc-matrix',
  hostAllowlist: [...parseHostAllowlist(config.ssrfHostAllowlist), SYNAPSE_HOST].filter(Boolean),
  // Internal mesh Synapse admin API is HTTP on a private host; the IP guard still
  // blocks loopback/link-local/metadata after DNS resolution.
  allowedSchemes: ['https:', 'http:'],
  allowInternalNetworks: true,
});

/**
 * Matrix client-server identity resolved for a verified Keycloak user.
 *
 * `accessToken` is a real Synapse client-server access token scoped to the
 * caller's own Matrix account — every downstream CS-API call is therefore made
 * AS the user (principle of least privilege), never with an admin/service token.
 */
export interface MatrixIdentity {
  accessToken: string;
  matrixUserId: string;
  homeServer: string;
}

/**
 * Raised when the Synapse homeserver cannot mint an access token for the caller
 * (registration/login round-trips failed). Carries the HTTP status the route
 * should surface — 502 for an upstream Matrix failure.
 */
export class MatrixIdentityError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'MatrixIdentityError';
  }
}

/**
 * Map a Keycloak identity to a Matrix user + client-server access token.
 *
 * Registers the Matrix account on first use via the Synapse admin API
 * (idempotent — a 400 "user exists" falls through to a password login with the
 * deterministic service password). This is the single source of truth for the
 * KC→Matrix identity bridge, shared by the token-exchange route (which hands the
 * token to matrix-js-sdk clients) and the client-ops proxy (which uses it to
 * call the CS API on the user's behalf).
 */
export async function resolveMatrixIdentity(user: VerifiedUser): Promise<MatrixIdentity> {
  // Matrix account identity (localpart + derived service password) is keyed
  // ONLY on the stable user.userId — NEVER on the profile RPC. The profile is
  // fallible and its `username` is mutable; deriving identity from it would
  // yield a DIFFERENT matrixUserId + password whenever the RPC fails or the
  // username changes, splitting one Keycloak user across two Matrix accounts
  // (split-brain). Keying on user.userId makes the identity deterministic.
  const localpart = user.userId.toLowerCase().replace(/[^a-z0-9._=-]/g, '_');
  const matrixUserId = `@${localpart}:${config.matrixDomain}`;
  const matrixPassword = await deriveMatrixPassword(user.userId, localpart, config.synapseRegistrationSecret);

  // Display name is cosmetic only — a best-effort lookup that never affects the
  // account identity fixed above. An RPC failure simply falls back to the userId.
  let displayName = user.userId;
  try {
    const profile = await rpcService<Record<string, unknown> | null>('get_profile_display_name', {
      p_user_id: user.userId,
    });
    if (profile?.display_name) displayName = profile.display_name as string;
  } catch { /* display name is best-effort; identity is already fixed on userId */ }

  // Step 1: Get nonce from Synapse
  const nonceResp = await ssrfGuard.safeFetch(`${config.synapseAdminUrl}/_synapse/admin/v1/register`, {
    method: 'GET',
    signal: AbortSignal.timeout(10_000),
  });

  if (!nonceResp.ok) {
    throw new MatrixIdentityError(502, 'Matrix server unavailable');
  }

  const { nonce } = await nonceResp.json() as { nonce: string };

  // Step 2: Generate HMAC for admin registration
  const mac = await generateHmac(nonce, localpart, matrixPassword, config.synapseRegistrationSecret, false);

  // Step 3: Register (idempotent — 400 if exists)
  const registerResp = await ssrfGuard.safeFetch(`${config.synapseAdminUrl}/_synapse/admin/v1/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nonce,
      username: localpart,
      displayname: displayName,
      password: matrixPassword,
      admin: false,
      mac,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (registerResp.ok) {
    const regData = await registerResp.json() as { access_token: string };
    return { accessToken: regData.access_token, matrixUserId, homeServer: config.matrixDomain };
  }

  // User already exists — login with the deterministic service password.
  const loginResp = await ssrfGuard.safeFetch(
    `${config.synapseAdminUrl}/_matrix/client/v3/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'm.login.password',
        identifier: { type: 'm.id.user', user: matrixUserId },
        password: matrixPassword,
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!loginResp.ok) {
    throw new MatrixIdentityError(502, 'Matrix login failed');
  }

  const loginData = await loginResp.json() as { access_token: string };
  return { accessToken: loginData.access_token, matrixUserId, homeServer: config.matrixDomain };
}

/** Generate HMAC-SHA1 for Synapse admin registration */
async function generateHmac(
  nonce: string,
  username: string,
  password: string,
  sharedSecret: string,
  admin: boolean,
): Promise<string> {
  const encoder = new TextEncoder();
  const message = `${nonce}\0${username}\0${password}\0${admin ? 'admin' : 'notadmin'}`;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(sharedSecret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function deriveMatrixPassword(userId: string, localpart: string, sharedSecret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(sharedSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${userId}:${localpart}`));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
