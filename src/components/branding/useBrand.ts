import { useContext } from "react";
import { BrandContext } from "./BrandContext";
import type { BrandingProfile } from "@/lib/schemas/brandingProfileSchemas";

/**
 * Read the resolved branding profile from `BrandContext`.
 *
 * Returns `null` when the resolution is still pending OR the resolver
 * decided no brand applies (e.g. unmapped hostname). Consumers must
 * fall back to build-time defaults rather than throwing on null —
 * blocking render on brand resolution would cause a flash of empty
 * UI on first paint.
 *
 * Typical idiom:
 *
 *   const brand = useBrand();
 *   const brandName = brand?.operator_name ?? "Platform";
 *
 * Lives in a separate file from `BrandProvider` so the provider file
 * exports components only (Vite Fast Refresh constraint).
 */
export function useBrand(): BrandingProfile | null {
  return useContext(BrandContext);
}
