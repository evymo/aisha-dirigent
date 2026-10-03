import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { PageLoader } from "@/components/layout/PageLoader";
import { useHostnameBranding } from "@/hooks/useHostnameBranding";

interface HostnamePrimaryRouteRedirectProps {
  children: ReactNode;
}

/**
 * HostnamePrimaryRouteRedirect
 *
 * Wraps the root (`/`) route element. When the active hostname maps to a
 * `branding_hostname_mapping` row that defines a `primary_route`, the
 * landing redirects there (e.g. `umbrella.example.com` → `/longevity`,
 * `therapy.example.com` → `/therapy`). This implements the multi-brand
 * default-landing decision in pure runtime — no env vars, no build flags.
 *
 * Why a guard component instead of a router loader:
 *   React Router `loader`s run before the QueryClient is available, and
 *   we want to share the same React Query cache as the rest of the app
 *   (so the resolved hostname branding is fetched exactly once and the
 *   downstream `HostnameBrandingBridge` re-uses the cached result).
 *   A small redirect component inside the route element keeps everything
 *   in the React tree.
 *
 * Loading behaviour:
 *   First page load → shows `<PageLoader />` for the duration of the RPC.
 *   This is intentional: rendering the index page just to immediately
 *   navigate away would cause a visible flash + unnecessary chunk loads
 *   (`Index` page chunk + its data loaders). Showing the loader for
 *   ~50–100 ms (warm cache) or ~150–300 ms (cold) is the better UX.
 *
 * Falls through to children when:
 *   - `primary_route` is null (hostname mapped but no preferred landing)
 *   - `primary_route` equals the current path (already there — no loop)
 *   - hostname has no mapping at all (`data === null`)
 *   - RPC failed (treated like "no mapping" — user still sees index)
 */
export function HostnamePrimaryRouteRedirect({ children }: HostnamePrimaryRouteRedirectProps) {
  const { data: hostBranding, isPending } = useHostnameBranding();
  const location = useLocation();

  // First fetch — block render to avoid flash. Subsequent loads hit the
  // 5-min React Query cache and skip this branch entirely.
  if (isPending) {
    return <PageLoader />;
  }

  const target = hostBranding?.primary_route;
  if (target && target !== location.pathname) {
    return <Navigate to={target} replace />;
  }

  return <>{children}</>;
}
