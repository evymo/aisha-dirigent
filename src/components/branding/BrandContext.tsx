import { createContext, type ReactNode } from "react";
import type { BrandingProfile } from "@/lib/schemas/brandingProfileSchemas";

/**
 * BrandContext
 *
 * React context exposing the resolved branding profile to any component
 * deep in the tree. Populated by `BrandingThemeProvider` (which itself is
 * fed by `HostnameBrandingBridge` for multi-brand hostname routing, or
 * by the legacy partner-id query for single-brand fallback).
 *
 * Why a context (and not just calling `useBrandingProfile()` everywhere):
 *   1. `useBrandingProfile(partnerId)` is partner-scoped — it can't see
 *      the hostname-resolved override that `HostnameBrandingBridge`
 *      computes. Without context, Header/Footer/etc. always fall back
 *      to the partner-id resolution and miss the hostname-driven brand.
 *   2. A single React Query roundtrip + context dispatch is cheaper
 *      than 6+ component-local hook calls all hitting the same cache.
 *   3. Type-safe `useBrand()` accessor surfaces nullability explicitly,
 *      forcing consumers to handle the "brand still loading" state.
 *
 * Consumers should treat `null` as "use the build-time defaults / labels"
 * — never block render on brand resolution. The intended idiom is:
 *
 *   const brand = useBrand();
 *   <span>{brand?.operator_name ?? "Platform"}</span>
 *
 * which paints the fallback during initial load and seamlessly swaps to
 * the resolved name once the bridge's RPC settles.
 */
export const BrandContext = createContext<BrandingProfile | null>(null);

interface BrandProviderProps {
  children: ReactNode;
  /**
   * Resolved branding profile. Pass `null` to publish "no brand resolved"
   * — consumers will use fallbacks. Pass `undefined` only if your wrapper
   * is still resolving (consumers see `null` either way).
   */
  value: BrandingProfile | null | undefined;
}

/**
 * Provider component. Typically wrapped inside `BrandingThemeProvider`
 * so brand text and brand CSS are both populated from the same source.
 */
export function BrandProvider({ children, value }: BrandProviderProps) {
  return <BrandContext.Provider value={value ?? null}>{children}</BrandContext.Provider>;
}
