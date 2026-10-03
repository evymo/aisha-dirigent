import type { ReactNode } from "react";
import { BrandingThemeProvider } from "@/components/BrandingThemeProvider";
import { useHostnameBranding } from "@/hooks/useHostnameBranding";

interface HostnameBrandingBridgeProps {
  children: ReactNode;
}

/**
 * HostnameBrandingBridge
 *
 * Top-level glue between `useHostnameBranding` (which inspects
 * `window.location.hostname` and queries `get_branding_for_hostname`) and
 * the visual layer (`BrandingThemeProvider`, which injects CSS variables
 * + favicon).
 *
 * Lifecycle:
 *   1. On mount, queries the RPC for the current hostname.
 *   2. While pending: forwards `profile={undefined}` so the provider falls
 *      back to its legacy partner-id query (the global default brand).
 *      This avoids a flash-of-unstyled-content while we wait for the
 *      hostname row.
 *   3. On success (mapped hostname → published profile): forwards the
 *      resolved profile, which takes precedence in the provider and
 *      paints the brand CSS variables.
 *   4. On failure / unmapped hostname (`data === null`): forwards
 *      `profile={null}` explicitly so the provider clears any previous
 *      brand and shows the build-time defaults from index.css.
 *
 * Why a wrapper instead of inlining into main.tsx:
 *   `useHostnameBranding` is a React Query hook → it must live inside the
 *   `QueryClientProvider` subtree. main.tsx is where that boundary lives,
 *   so we need a child component to call the hook. Keeping that child
 *   focused on a single concern (resolve → forward) makes the wiring
 *   easy to reason about and unit-test in isolation.
 *
 * No homepage-redirect logic lives here — that requires React Router's
 * `useNavigate`, which must live *inside* the `RouterProvider` subtree.
 * Route-level redirect is implemented in `HostnamePrimaryRouteRedirect`.
 */
export function HostnameBrandingBridge({ children }: HostnameBrandingBridgeProps) {
  const { data: hostBranding, isPending } = useHostnameBranding();

  // Pending → undefined (let provider use its partner-id fallback)
  // Resolved → forward the profile (or null if the RPC returned no mapping)
  const profile = isPending ? undefined : (hostBranding?.profile ?? null);

  return <BrandingThemeProvider profile={profile}>{children}</BrandingThemeProvider>;
}
