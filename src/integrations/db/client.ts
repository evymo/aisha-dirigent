/**
 * Aisha data client — thin shim routing through pure API client.
 *
 * Provides `aisha.rpc()`, `.functions.invoke()`, `.storage.from()`, `.channel()`
 * backed by `@/integrations/api/client` (no supabase-js runtime).
 *
 * Prefer `api` from `@/integrations/api` in new code.
 */
import { api, gatewayUrl, isUsingDevFallback } from '@/integrations/api/client';
import { storage } from '@/integrations/api/storage';
import { realtime, RealtimeChannel } from '@/integrations/api/realtime';

import type { Database } from './types';
import type { ApiClient, ApiResponse } from '@/integrations/api/client';

// ---------------------------------------------------------------------------
// Config exports
// ---------------------------------------------------------------------------

type AishaConfigSource = 'env' | 'dev-fallback';

type AishaConfigResult = {
  url: string;
  key: string;
  source: AishaConfigSource;
  missing?: string[];
};

const readNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/**
 * Validates the data client configuration.
 *
 * @param key - Placeholder key (not used for auth).
 * @param mode - Vite mode.
 * @param url - Gateway / PostgREST URL.
 * @returns Validated config.
 */
export const validateAishaConfig = (
  url: string | undefined,
  key: string | undefined,
  mode: string | undefined = import.meta.env.MODE
): AishaConfigResult => {
  const normalizedUrl = readNonEmptyString(url);

  if (normalizedUrl) {
    return {
      url: normalizedUrl,
      key: key ?? 'postgrest-no-anon-key',
      source: 'env',
    };
  }

  return {
    url: gatewayUrl,
    key: 'postgrest-no-anon-key',
    source: isUsingDevFallback ? 'dev-fallback' : 'env',
    missing: ['VITE_AISHA_GATEWAY_URL'],
  };
};

export const aishaConfig: AishaConfigResult = {
  url: gatewayUrl,
  key: 'postgrest-no-anon-key',
  source: isUsingDevFallback ? 'dev-fallback' : 'env',
};

export const isUsingAishaDevFallback = isUsingDevFallback;

/** Always true — config has a dev fallback. */
export const isAishaConfigured = true;

// ---------------------------------------------------------------------------
// `aisha` data client
// ---------------------------------------------------------------------------

type PublicFunctions = Database['public']['Functions'];

// Delegace se TÝMŽ generickým podpisem, ne `api.rpc.bind(api) as typeof api.rpc`:
// `as` porovnává výsledek `bind` (OmitThisParameter) s generickou metodou přes celé
// sjednocení klíčů Database.public.Functions — a od ~1 700 funkcí to tsc vzdá
// (TS2590 „union type that is too complex“, naměřeno 2026-09-29 při sloučení kola 12:
// 1 701 funkcí prošlo, 1 708 ne). Typovaná konstanta porovná typ jen sám se sebou.
const rpc: ApiClient['rpc'] = (functionName, args) => api.rpc(functionName, args);

export const aisha = {
  rpc,

  functions: {
    async invoke(
      functionName: string,
      options?: { body?: unknown; headers?: Record<string, string> },
    ): Promise<ApiResponse<unknown>> {
      return api.invoke(functionName, {
        body: options?.body,
        headers: options?.headers,
      });
    },
  },

  storage: {
    from: storage.from.bind(storage),
  },

  channel(name: string): RealtimeChannel {
    return realtime.channel(name);
  },

  removeChannel(channel: RealtimeChannel): void {
    realtime.removeChannel(channel);
  },

  auth: new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      throw new Error(
        `aisha.auth.${String(prop)}() is not available. ` +
        'Use @/integrations/auth/oidc-client for Keycloak OIDC auth.'
      );
    },
  }),
};


export type _AishaPublicFunctions = PublicFunctions;
