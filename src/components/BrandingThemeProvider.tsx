import { useEffect, useRef } from "react";
import { useBrandingProfile } from "@/hooks/useBrandingProfile";
import {
  brandingToCssVariables,
  brandingToDarkCssVariables,
} from "@/lib/schemas/brandingProfileSchemas";
import { BrandProvider } from "@/components/branding/BrandContext";
import { buildFontFaceCss } from "@/lib/branding/fontFaceCss";

import type { BrandingProfile } from "@/lib/schemas/brandingProfileSchemas";

interface BrandingThemeProviderProps {
  children: React.ReactNode;
  /**
   * Pre-resolved branding profile (e.g. from hostname mapping via
   * `useHostnameBranding`). When this prop is **explicitly provided** (even
   * when `null`), the partner-id resolution path is bypassed entirely —
   * the caller has already chosen the active brand.
   *
   * Leave undefined to fall back to the legacy partner-id lookup.
   */
  profile?: BrandingProfile | null;
  /**
   * Partner ID for white-label resolution via `get_branding_profile` RPC.
   * Only consulted when `profile` is `undefined`. NULL = global fallback brand.
   */
  partnerId?: string | null;
}

/**
 * BrandingThemeProvider
 *
 * Reads the resolved branding profile and injects CSS custom properties
 * into the document root, overriding build-time defaults from index.css.
 * Supports light/dark mode via separate variable sets.
 *
 * Two ways to source the profile (in precedence order):
 *  1. `profile` prop — pre-resolved (typical: hostname-driven via the
 *     `HostnameBrandingBridge` wrapper).
 *  2. `partnerId` prop — partner-scoped lookup via `get_branding_profile`.
 *
 * Place this near the root of the app (e.g. in App.tsx or Layout).
 */
export function BrandingThemeProvider({
  children,
  profile: explicitProfile,
  partnerId,
}: BrandingThemeProviderProps) {
  // Always invoke the partner-id query to keep hook order stable, but only
  // consume its data when no explicit profile was provided by the caller.
  // React Query caches aggressively, so an unused call costs ~nothing.
  const { data: partnerProfile } = useBrandingProfile(partnerId);
  const profile = explicitProfile !== undefined ? explicitProfile : partnerProfile;
  const styleRef = useRef<HTMLStyleElement | null>(null);

  useEffect(() => {
    if (!profile) return;

    const lightVars = brandingToCssVariables(profile);
    const darkVars = brandingToDarkCssVariables(profile);

    const lightCss = Object.entries(lightVars)
      .map(([k, v]) => `${k}: ${v};`)
      .join("\n    ");

    const darkCss = Object.entries(darkVars)
      .map(([k, v]) => `${k}: ${v};`)
      .join("\n    ");

    const fontCss = buildFontOverrideCss(profile);
    const fontFaceCss = buildFontFaceCss(profile);

    const cssText = `${fontFaceCss}
  :root {
    ${lightCss}
    ${fontCss}
  }
  .dark {
    ${darkCss}
  }
`;

    if (!styleRef.current) {
      const style = document.createElement("style");
      style.setAttribute("data-branding", "runtime");
      document.head.appendChild(style);
      styleRef.current = style;
    }

    styleRef.current.textContent = cssText;

    // Update favicon if specified
    if (profile.favicon_path) {
      updateFavicon(profile.favicon_path);
    }

    return () => {
      if (styleRef.current) {
        styleRef.current.remove();
        styleRef.current = null;
      }
    };
  }, [profile]);

  // Also publish the resolved profile via context so Header / Footer /
  // <Helmet> etc. can render brand text (`operator_name`, taglines)
  // without each component re-running the same RPC. See BrandContext.tsx
  // for the rationale.
  return <BrandProvider value={profile}>{children}</BrandProvider>;
}

/**
 * Build font family CSS override from branding profile.
 */
function buildFontOverrideCss(profile: BrandingProfile): string {
  const lines: string[] = [];
  if (profile.font_family_brand) {
    lines.push(`--font-brand: ${profile.font_family_brand};`);
  }
  if (profile.font_family_body) {
    lines.push(`--font-body: ${profile.font_family_body};`);
  }
  if (profile.font_family_code) {
    lines.push(`--font-code: ${profile.font_family_code};`);
  }
  return lines.join("\n    ");
}

/**
 * Dynamically update the favicon link element.
 */
function updateFavicon(faviconPath: string): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  // Assume branding-assets bucket with cache bust
  link.href = `${faviconPath}?v=${Date.now()}`;
}
