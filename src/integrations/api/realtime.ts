/**
 * Realtime subscription client — web wrapper over `@aisha/api-core`.
 *
 * Drop-in for `supabase.channel(name).on('postgres_changes', ...).subscribe()`.
 *
 * @module
 */
import { getAccessToken } from '@/integrations/auth/oidc-client';
import { safeError } from '@/lib/security/safeLogger';
import {
  createRealtimeClient,
  RealtimeChannel,
  type ChangeFilter,
  type PostgresChangePayload,
} from '@aisha/api-core';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function resolveWsUrl(): string {
  const meta = import.meta as unknown as { env?: Record<string, unknown> };
  const env = meta.env ?? {};

  // Priority 1: explicit WebSocket URL
  const wsUrl =
    typeof env.VITE_WS_URL === 'string' && env.VITE_WS_URL.trim().length > 0
      ? env.VITE_WS_URL.trim()
      : undefined;
  if (wsUrl) return wsUrl;

  // Priority 2: derive from API URL
  const apiUrl =
    typeof env.VITE_API_URL === 'string' && env.VITE_API_URL.trim().length > 0
      ? env.VITE_API_URL.trim()
      : typeof env.VITE_AISHA_GATEWAY_URL === 'string' && env.VITE_AISHA_GATEWAY_URL.trim().length > 0
        ? env.VITE_AISHA_GATEWAY_URL.trim()
        : undefined;
  if (apiUrl) return apiUrl.replace(/^http/, 'ws') + '/realtime/v1';

  // Priority 3 (browser only): same-origin WSS path. NEVER fall back to
  // localhost — in production every browser would try connecting to its
  // own machine. Same-origin via Traefik handles WS upgrade correctly.
  if (typeof window !== 'undefined' && window.location?.host) {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}/realtime/v1`;
  }

  // Non-browser context (SSR/tests) without env config — fail loudly
  // rather than silently misroute. The caller MUST configure VITE_WS_URL
  // or VITE_API_URL at build time.
  throw new Error(
    'realtime: no WebSocket URL — set VITE_WS_URL or VITE_API_URL at build time',
  );
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/**
 * Realtime client — drop-in for `supabase.channel()` / `removeChannel()`.
 *
 * @example
 * ```ts
 * const channel = realtime.channel("notifications")
 *   .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, cb)
 *   .subscribe();
 * realtime.removeChannel(channel);
 * ```
 */
export const realtime = createRealtimeClient({
  wsUrl: resolveWsUrl(),
  getToken: async () => (await getAccessToken()) ?? null,
  onError: (scope, err) => safeError(scope, err),
});

export { RealtimeChannel };
export type { ChangeFilter, PostgresChangePayload };
