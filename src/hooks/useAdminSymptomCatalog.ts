import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";
import { usePermissions } from "./usePermissions";
import { useSession } from "./useSession";
import { useAdminGuard } from "@/hooks/useAdminGuard";
import type { Json } from "@/integrations/db/types";

// ============================================================================
// Schemas
// ============================================================================

const translationEntrySchema = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
});

const symptomCatalogAdminSchema = z.object({
  id: z.string(),
  code: z.string(),
  category: z.string(),
  icon: z.string(),
  color: z.string(),
  default_severity_scale: z.number(),
  sort_order: z.number(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  translations: z.record(z.string(), translationEntrySchema).nullable(),
});

const symptomCatalogAdminArraySchema = z.array(symptomCatalogAdminSchema);

// ============================================================================
// Types
// ============================================================================

export type SymptomCatalogAdmin = z.infer<typeof symptomCatalogAdminSchema>;

export interface UpsertSymptomCatalogParams {
  id?: string;
  code: string;
  category: string;
  icon: string;
  color: string;
  default_severity_scale: number;
  sort_order: number;
  is_active: boolean;
  translations: Record<string, { name: string; description?: string }>;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook for fetching symptom catalog entries (admin only).
 * Returns all entries including inactive ones with translations for all locales.
 */
export function useSymptomCatalogAdmin() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["admin-symptom-catalog"],
    queryFn: async (): Promise<SymptomCatalogAdmin[]> => {
      if (!isAdmin || !user) return [];
      const { data, error } = await aisha.rpc("get_symptom_catalog_admin");
      if (error) {
        safeError("adminSymptomCatalog.fetch.failed", error);
        throw new Error(error.message);
      }

      const parsed = symptomCatalogAdminArraySchema.safeParse(data);
      if (!parsed.success) {
        safeError("adminSymptomCatalog.parse.failed", parsed.error);
        return (data || []) as SymptomCatalogAdmin[];
      }

      return parsed.data;
    },
    staleTime: 2 * 60 * 1000,
    enabled: isAdmin && !!user,
  });
}

/**
 * Hook for creating a symptom catalog entry.
 */
export function useCreateSymptomCatalog() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("upsert_symptom_catalog_admin", async (params: UpsertSymptomCatalogParams) => {
      const { error } = await aisha.rpc("upsert_symptom_catalog_admin", {
        p_category: params.category,
        p_code: params.code,
        p_color: params.color,
        p_default_severity_scale: params.default_severity_scale,
        p_icon: params.icon,
        p_id: undefined,
        p_is_active: params.is_active,
        p_sort_order: params.sort_order,
        p_translations: params.translations as unknown as Json,
      });

      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-symptom-catalog"] });
    },
    onError: (error) => {
      safeError("adminSymptomCatalog.create.failed", error);
    },
  });
}

/**
 * Hook for updating a symptom catalog entry.
 */
export function useUpdateSymptomCatalog() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("upsert_symptom_catalog_admin", async (params: UpsertSymptomCatalogParams) => {
      const { error } = await aisha.rpc("upsert_symptom_catalog_admin", {
        p_category: params.category,
        p_code: params.code,
        p_color: params.color,
        p_default_severity_scale: params.default_severity_scale,
        p_icon: params.icon,
        p_id: params.id,
        p_is_active: params.is_active,
        p_sort_order: params.sort_order,
        p_translations: params.translations as unknown as Json,
      });

      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-symptom-catalog"] });
    },
    onError: (error) => {
      safeError("adminSymptomCatalog.update.failed", error);
    },
  });
}

/**
 * Hook for deleting (deactivating) a symptom catalog entry.
 */
export function useDeleteSymptomCatalog() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("delete_symptom_catalog_admin", async (id: string) => {
      const { error } = await aisha.rpc("delete_symptom_catalog_admin", {
        p_id: id,
      });

      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-symptom-catalog"] });
    },
    onError: (error) => {
      safeError("adminSymptomCatalog.delete.failed", error);
    },
  });
}
