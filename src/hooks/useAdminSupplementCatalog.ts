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

const productCatalogAdminSchema = z.object({
  id: z.string(),
  code: z.string(),
  category: z.string(),
  icon: z.string(),
  color: z.string(),
  default_dose_amount: z.number().nullable(),
  default_dose_unit: z.string().nullable(),
  default_doses_per_day: z.number().nullable(),
  default_dose_timing: z.array(z.string()).nullable(),
  sort_order: z.number(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  translations: z.record(z.string(), translationEntrySchema).nullable(),
});

const productCatalogAdminArraySchema = z.array(productCatalogAdminSchema);

// ============================================================================
// Types
// ============================================================================

export type ProductCatalogAdmin = z.infer<typeof productCatalogAdminSchema>;

export interface UpsertProductCatalogParams {
  id?: string;
  code: string;
  category: string;
  icon: string;
  color: string;
  default_dose_amount: number | null;
  default_dose_unit: string | null;
  default_doses_per_day: number | null;
  default_dose_timing: string[] | null;
  sort_order: number;
  is_active: boolean;
  translations: Record<string, { name: string; description?: string }>;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook for fetching product catalog entries (admin only).
 * Returns all entries including inactive ones with translations for all locales.
 */
export function useProductCatalogAdmin() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["admin-product-catalog"],
    queryFn: async (): Promise<ProductCatalogAdmin[]> => {
      if (!isAdmin || !user) return [];
      const { data, error } = await aisha.rpc("get_product_catalog_admin");
      if (error) {
        safeError("adminProductCatalog.fetch.failed", error);
        throw new Error(error.message);
      }

      const parsed = productCatalogAdminArraySchema.safeParse(data);
      if (!parsed.success) {
        safeError("adminProductCatalog.parse.failed", parsed.error);
        return (data || []) as ProductCatalogAdmin[];
      }

      return parsed.data;
    },
    staleTime: 2 * 60 * 1000,
    enabled: isAdmin && !!user,
  });
}

/**
 * Hook for creating a product catalog entry.
 */
export function useCreateProductCatalog() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("upsert_product_catalog_admin", async (params: UpsertProductCatalogParams) => {
      const { error } = await aisha.rpc("upsert_product_catalog_admin", {
        p_category: params.category,
        p_code: params.code,
        p_color: params.color,
        p_default_dose_amount: params.default_dose_amount ?? undefined,
        p_default_dose_timing: params.default_dose_timing ?? undefined,
        p_default_dose_unit: params.default_dose_unit ?? undefined,
        p_default_doses_per_day: params.default_doses_per_day ?? undefined,
        p_icon: params.icon,
        p_id: undefined,
        p_is_active: params.is_active,
        p_sort_order: params.sort_order,
        p_translations: params.translations as unknown as Json,
      });

      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-product-catalog"] });
    },
    onError: (error) => {
      safeError("adminProductCatalog.create.failed", error);
    },
  });
}

/**
 * Hook for updating a product catalog entry.
 */
export function useUpdateProductCatalog() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("upsert_product_catalog_admin", async (params: UpsertProductCatalogParams) => {
      const { error } = await aisha.rpc("upsert_product_catalog_admin", {
        p_category: params.category,
        p_code: params.code,
        p_color: params.color,
        p_default_dose_amount: params.default_dose_amount ?? undefined,
        p_default_dose_timing: params.default_dose_timing ?? undefined,
        p_default_dose_unit: params.default_dose_unit ?? undefined,
        p_default_doses_per_day: params.default_doses_per_day ?? undefined,
        p_icon: params.icon,
        p_id: params.id,
        p_is_active: params.is_active,
        p_sort_order: params.sort_order,
        p_translations: params.translations as unknown as Json,
      });

      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-product-catalog"] });
    },
    onError: (error) => {
      safeError("adminProductCatalog.update.failed", error);
    },
  });
}

/**
 * Hook for deleting (deactivating) a product catalog entry.
 */
export function useDeleteProductCatalog() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("delete_product_catalog_admin", async (id: string) => {
      const { error } = await aisha.rpc("delete_product_catalog_admin", {
        p_id: id,
      });

      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-product-catalog"] });
    },
    onError: (error) => {
      safeError("adminProductCatalog.delete.failed", error);
    },
  });
}
