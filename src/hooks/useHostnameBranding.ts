import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import {
  brandingProfileSchema,
  type BrandingProfile,
} from "@/lib/schemas/brandingProfileSchemas";
import { z } from "zod";

/**
 * Result of hostname → branding resolution.
 *
 * Shape mirrors the `get_branding_for_hostname` RPC: published profile plus
 * the hostname-mapping metadata (brand variant + primary/secondary routes)
 * the SPA needs for first-paint routing decisions.
 */
export interface HostnameBranding {
  /** Resolved published branding profile (theme, logo, operator info). */
  profile: BrandingProfile;
  /**
   * Instance-defined brand variant — an OPEN string, not a closed set, so any
   * downstream instance (tenant, or another fork) sets its own value without
   * editing this upstream type. Known values "umbrella"/"therapy-first" drive
   * multi-route precedence; any other value is identification-only (no consumer
   * branches on it today).
   */
  brand_variant: string;
  /** Default landing route for this hostname (e.g. "/longevity" for an umbrella brand). */
  primary_route: string | null;
  /** Alternate route the brand exposes (e.g. "/therapy" for a therapy-first brand). */
  secondary_route: string | null;
}

/**
 * Shape of `get_branding_for_hostname` RPC response.
 *
 * The RPC emits a flat envelope: `status` + hostname-mapping fields
 * (brand_variant/primary_route/secondary_route) at the top, with the
 * bare published `branding_profiles` row nested under `profile`. We
 * validate the bare row via `brandingProfileSchema` directly — the
 * discriminated `brandingProfileRpcResponseSchema` wraps a different
 * RPC (`get_branding_profile`) and would mismatch the shape here.
 */
const hostnameBrandingSchema = z.object({
  status: z.literal("ok"),
  brand_variant: z.string(), // open set — instance-defined, keeps this upstream file fork-clean
  primary_route: z.string().nullable(),
  secondary_route: z.string().nullable(),
  profile: brandingProfileSchema,
});

/**
 * Resolve the current `window.location.hostname` to a published branding profile.
 *
 * Multi-brand single-instance deployments (e.g. `umbrella.example.com`
 * → umbrella brand vs `therapy.example.com` → therapy-first brand) need
 * hostname-driven theme + route resolution before first paint.
 *
 * Returns `null` when:
 *   - SSR / no `window` (impossible in this SPA, but the type honours it)
 *   - Hostname has no row in `branding_hostname_mapping`
 *   - Mapped profile is unpublished (admin in mid-edit)
 *
 * Consumers should fall back to the global default brand via
 * `useBrandingProfile()` (no argument) when this returns null.
 *
 * Cache: 5min staleTime — branding rarely changes mid-session, and the
 * resolved row is already small (~2 KB JSON).
 *
 * @example
 * ```tsx
 * const { data: hostBrand } = useHostnameBranding();
 * if (hostBrand) applyTheme(hostBrand.profile);
 * if (hostBrand?.primary_route && location.pathname === "/") {
 *   navigate(hostBrand.primary_route);
 * }
 * ```
 */
export function useHostnameBranding() {
  const hostname = typeof window !== "undefined" ? window.location.hostname : "";

  return useQuery({
    queryKey: ["hostname-branding", hostname],
    enabled: hostname.length > 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    // Retry **only transient failures** — network blips and 5xx from the
    // PostgREST layer during cold-start / bootstrap surges.
    //   - Pre-fix this hook swallowed every error into `return null`, so
    //     React Query never saw a thrown promise → no retry. A single
    //     transient 5xx during the SPA's parallel bootstrap surge left
    //     brand resolution permanently null → no theme, no redirect, no
    //     header text — until the user manually reloaded.
    //   - 3 retries × exponential backoff (default: 1s, 2s, 4s — capped at
    //     30s by RQ) cleanly handles a few-second surge without compounding
    //     into a thunder-on-recovery storm. PG max_connections=500 drží
    //     absolutní míru selhání dost nízko, aby opakování skoro vždy
    //     dosedlo. (Pooler v transakčním režimu by ji srazil ještě níž,
    //     ale nasazený NENÍ — viz wp-1-3-pgbouncer.gate.)
    //   - We deliberately DON'T retry parse failures or "no mapping"
    //     (data === null) — those are deterministic states. retry would
    //     never improve them and would mask real schema drift.
    retry: 3,
    retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 30_000),
    queryFn: async (): Promise<HostnameBranding | null> => {
      const { data, error } = await aisha.rpc("get_branding_for_hostname", {
        p_hostname: hostname,
      });
      if (error) {
        // PostgREST / gateway error — transient surge or 5xx. THROW so
        // React Query schedules a retry per the policy above. We log the
        // error from `safeError` too so it still surfaces in Sentry /
        // operator dashboards even when the retry succeeds on attempt 2.
        safeError("hostnameBranding.fetch", error);
        throw new Error(`get_branding_for_hostname failed: ${error.message}`);
      }
      if (data === null) {
        // Hostname genuinely has no `branding_hostname_mapping` row, or the
        // mapped profile is not published yet. Deterministic — caller
        // falls back to the global default brand via useBrandingProfile().
        return null;
      }
      const parsed = hostnameBrandingSchema.safeParse(data);
      if (!parsed.success) {
        // Schema drift — the RPC returned a row but a column has changed
        // shape. Retrying won't help; logging + returning null lets the
        // caller fall back to the default brand while we get an alert.
        safeError("hostnameBranding.parse", parsed.error);
        return null;
      }
      return {
        profile: parsed.data.profile,
        brand_variant: parsed.data.brand_variant,
        primary_route: parsed.data.primary_route,
        secondary_route: parsed.data.secondary_route,
      };
    },
  });
}
