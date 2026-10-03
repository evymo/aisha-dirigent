/**
 * Pure HTTP API client — web wrapper over the shared `@aisha/api-core`.
 *
 * Talks to the Fastify API Gateway which proxies:
 * - /rest/v1/rpc/{fn} → PostgREST (RPC data access)
 * - /functions/v1/{fn} → Fastify microservices (domain logic)
 *
 * Auth: Keycloak OIDC access token injected via Authorization header.
 * No Supabase dependencies. Zero runtime dep on @supabase/supabase-js.
 *
 * @module
 */
import { getAccessToken } from '@/integrations/auth/oidc-client';
import { safeWarn } from '@/lib/security/safeLogger';
import {
  createApiCore,
  type ApiClient as CoreApiClient,
  type ApiError,
  type ApiResponse,
  type InvokeOptions,
} from '@aisha/api-core';
import type { Database, Json } from '@/integrations/db/types';

// ---------------------------------------------------------------------------
// Types (re-exported so existing imports keep working)
// ---------------------------------------------------------------------------

export type { ApiError, ApiResponse, InvokeOptions };

type PublicFunctions = Database['public']['Functions'];

export type ApiClient = CoreApiClient<PublicFunctions>;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const readNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/** Dev-only fallback. Never used in production builds — see resolveGatewayUrl. */
const DEV_FALLBACK_GATEWAY_URL = 'http://localhost:3001';

function resolveGatewayUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
  const apiUrl = readNonEmptyString(env?.VITE_API_URL);
  if (apiUrl) return apiUrl;

  const gatewayFromEnv = readNonEmptyString(env?.VITE_AISHA_GATEWAY_URL);
  if (gatewayFromEnv) return gatewayFromEnv;

  // Production: derive from current page origin (same-origin via reverse proxy).
  // NEVER fall back to localhost — every browser would target its own machine.
  // Build pipeline MUST set VITE_API_URL or VITE_AISHA_GATEWAY_URL.
  const isProd = (env?.PROD === true) || (env?.MODE === 'production') || (env?.DEV === false);
  if (isProd && typeof window !== 'undefined' && window.location?.origin) {
    safeWarn(
      'api.client.missingGatewayUrl',
      'Missing VITE_API_URL in prod build — using same-origin fallback. Configure build env.',
    );
    return window.location.origin;
  }

  safeWarn('api.client.missingGatewayUrl', 'Missing VITE_API_URL. Using dev fallback.');
  return DEV_FALLBACK_GATEWAY_URL;
}

const GATEWAY_URL = resolveGatewayUrl();

// Preconnect hint for performance
if (typeof document !== 'undefined') {
  try {
    const origin = new URL(GATEWAY_URL).origin;
    if (!document.head.querySelector(`link[rel="preconnect"][href="${origin}"]`)) {
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = origin;
      link.crossOrigin = '';
      document.head.appendChild(link);
    }
  } catch {
    // Ignore invalid URL.
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/**
 * Pure HTTP API client for the Aisha platform (web).
 *
 * Drop-in replacement for `supabase` from `@/integrations/db/client`.
 * Same `{ data, error }` response contract, full RPC type safety from
 * generated Database types.
 */
export const api: ApiClient = createApiCore<PublicFunctions>({
  gatewayUrl: GATEWAY_URL,
  getToken: async () => (await getAccessToken()) ?? null,
  onWarn: (scope, err) => safeWarn(scope, err),
});

/** Gateway URL — exported for storage/realtime modules. */
export const gatewayUrl = GATEWAY_URL;

/**
 * Whether the client is using dev fallback (no production env vars).
 */
export const isUsingDevFallback = GATEWAY_URL === DEV_FALLBACK_GATEWAY_URL;

// ---------------------------------------------------------------------------
// Factory — create an API client with a custom token source
// ---------------------------------------------------------------------------

/**
 * Create an API client that uses a custom token function.
 *
 * Used for PHI-mode (secure) clients that inject a separate KC access token
 * instead of the default `getAccessToken()`.
 */
export function createApiClient(getToken: () => Promise<string | null>): ApiClient {
  return createApiCore<PublicFunctions>({
    gatewayUrl: GATEWAY_URL,
    getToken,
    onWarn: (scope, err) => safeWarn(scope, err),
  });
}

export type { Json, Database };
