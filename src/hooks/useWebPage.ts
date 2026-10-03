/**
 * Hook for fetching a published web page by slug.
 *
 * Used by the public PageRenderer to load GrapeJS canvas content.
 * Returns canvas_html, canvas_css, and i18n key metadata for SEO.
 *
 * @module
 */

import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { parseRpcArray } from "@/lib/validation/rpcSchemas";
import { webPagePublicSchema } from "@/lib/schemas/webPageSchemas";

import type { WebPagePublic } from "@/lib/schemas/webPageSchemas";

const STALE_TIME = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches a single published web page by its URL slug.
 *
 * @param slug - The URL slug to look up (e.g. "index", "faq")
 * @returns Query result with the web page data or null if not found
 */
/**
 * Dotaz na publikovanou stránku — vytažený z hooku, aby ho šlo spustit
 * i MIMO React (prefetch v main.tsx). Klíč i queryFn musí být tytéž,
 * jinak by prefetch plnil jinou přihrádku cache než hook čte.
 */
export function webPageQuery(slug: string) {
  return {
    queryFn: async (): Promise<WebPagePublic | null> => {
      const { data, error } = await aisha.rpc("get_web_page_by_slug", {
        p_hostname: window.location.hostname || undefined,
        p_slug: slug,
      });
      if (error) throw new Error(error.message);
      const rows = parseRpcArray(webPagePublicSchema, data, "get_web_page_by_slug");
      return rows[0] ?? null;
    },
    queryKey: ["web-page", slug] as const,
    staleTime: STALE_TIME,
  };
}

export function useWebPage(slug: string | undefined) {
  return useQuery<WebPagePublic | null>({
    enabled: !!slug,
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_web_page_by_slug", {
        p_hostname: window.location.hostname || undefined,
        p_slug: slug!,
      });
      if (error) throw new Error(error.message);
      const rows = parseRpcArray(webPagePublicSchema, data, "get_web_page_by_slug");
      return rows[0] ?? null;
    },
    queryKey: ["web-page", slug],
    staleTime: STALE_TIME,
  });
}
