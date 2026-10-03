/**
 * ŠABLONA: Nový Custom Hook
 *
 * Zkopíruj, přejmenuj a upravit pro novou feature.
 * Povinný checklist po implementaci:
 * - [ ] Abecedně seřazené options parametry
 * - [ ] Zod schéma pro response
 * - [ ] enabled závisí na user + případně permissions
 * - [ ] Smysluplný queryKey s relevantními parametry
 * - [ ] staleTime nastaven
 * - [ ] onError loguje přes safeError() — žádná sensitive data
 * - [ ] Export přidán do src/hooks/index.ts
 * - [ ] Test vytvořen a prošel
 */

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useSession } from "./useSession";
import { apiClient } from "@/lib/api/client";
import { safeError } from "@/lib/security/safeLogger";

// ============================================================
// ZOD SCHÉMA — exportovat pro použití v testech
// ============================================================
export const featureItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  createdAt: z.string().datetime(),
  // ... doplnit dle API response
});

export type FeatureItem = z.infer<typeof featureItemSchema>;

// ============================================================
// OPTIONS — abecedně řazené parametry
// ============================================================
export interface UseFeatureOptions {
  enabled?: boolean;
  filter?: string;
  limit?: number;
}

// ============================================================
// HOOK
// ============================================================
/**
 * Načítá [popis featury].
 *
 * @param options.enabled - Pokud false, query se neprovede (default: true)
 * @param options.filter - Filtr pro [popis]
 * @param options.limit - Maximální počet položek (default: 20)
 *
 * @returns React Query result s polem FeatureItem
 *
 * @example
 * const { data, isLoading } = useFeature({ limit: 10, filter: "active" });
 */
export function useFeature(options: UseFeatureOptions = {}) {
  const { enabled = true, filter, limit = 20 } = options;
  const { user } = useSession();

  return useQuery({
    queryKey: ["feature", { filter, limit }], // Přizpůsob dle endpointu
    queryFn: async () => {
      const response = await apiClient.get("/feature", {
        params: {
          ...(filter && { filter }),
          limit,
        },
      });
      // ✅ Validuj response — parse hází ZodError při nevalidních datech
      return featureItemSchema.array().parse(response.data);
      // ← Alternativa pro "tiché" selhání (zaloguje, vrátí []):
      // return parseArraySafe(response.data, featureItemSchema);
    },
    enabled: enabled && !!user?.id,
    staleTime: 5 * 60 * 1000, // 5 minut — přizpůsob dle potřeby
    meta: {
      errorHandler: (error: unknown) => {
        console.error("useFeature: fetch failed:", safeError(error));
      },
    },
  });
}
