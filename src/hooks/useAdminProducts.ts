import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { toJson } from "@/lib/types/json";
import { parseArrayResponse, productAdminArraySchema, type ProductAdminRow } from "@/lib/schemas/adminSchemas";
import { usePermissions } from "./usePermissions";
import { useSession } from "./useSession";
import { useAdminGuard } from "@/hooks/useAdminGuard";

export type ProductAdmin = ProductAdminRow;

/**
 * Hook for fetching products with admin privileges
 */
export function useProductsAdmin(enabled = true) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["admin-products"],
    queryFn: async (): Promise<ProductAdmin[]> => {
      if (!isAdmin || !user) return [];
      const { data, error } = await aisha.rpc("get_products_admin");
      if (error) {
        safeError("admin.products.fetchFailed", error);
        throw new Error(error.message);
      }
      return parseArrayResponse(productAdminArraySchema, data, "products");
    },
    enabled: enabled && isAdmin && !!user,
  });
}

/**
 * Hook for creating a product
 */
export function useCreateProduct() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("create_product_admin", async (productData: Partial<ProductAdmin>) => {
      const { error } = await aisha.rpc("create_product_admin", {
        p_badge_key: productData.badge_key !== null ? productData.badge_key : undefined,
        p_base_locale: productData.base_locale !== null ? productData.base_locale : undefined,
        p_benefits_content: productData.benefits_content ? toJson(productData.benefits_content) : undefined,
        p_benefits_title_key: productData.benefits_title_key !== null ? productData.benefits_title_key : undefined,
        p_category: productData.category !== null ? productData.category : undefined,
        p_compare_at_price: productData.compare_at_price !== null ? productData.compare_at_price : undefined,
        p_composition_title_key: productData.composition_title_key !== null ? productData.composition_title_key : undefined,
        p_description: productData.description || "",
        p_description_key: productData.description_key !== null ? productData.description_key : undefined,
        p_doses_per_package: productData.doses_per_package !== null ? productData.doses_per_package : undefined,
        p_image_alt_key: productData.image_alt_key !== null ? productData.image_alt_key : undefined,
        p_image_url: productData.image_url !== null ? productData.image_url : undefined,
        p_images: productData.images !== undefined ? toJson(productData.images ?? []) : undefined,
        p_in_stock: productData.in_stock ?? true,
        p_name: productData.name || "",
        p_name_key: productData.name_key !== null ? productData.name_key : undefined,
        p_origin_content: productData.origin_content ? toJson(productData.origin_content) : undefined,
        p_price: productData.price || 0,
        p_short_description: productData.short_description !== null ? productData.short_description : undefined,
        p_short_description_key: productData.short_description_key !== null ? productData.short_description_key : undefined,
        p_slug: productData.slug || "",
        p_stock_quantity: productData.stock_quantity ?? 0,
        p_substances_content: productData.substances_content ? toJson(productData.substances_content) : undefined,
        p_tagline_key: productData.tagline_key !== null ? productData.tagline_key : undefined,
        p_target_audience: productData.target_audience !== null ? productData.target_audience : undefined,
        p_usage_content: productData.usage_content ? toJson(productData.usage_content) : undefined,
        p_usage_title_key: productData.usage_title_key !== null ? productData.usage_title_key : undefined,
        p_use_case: productData.use_case !== null ? productData.use_case : undefined,
      });
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      queryClient.invalidateQueries({ queryKey: ["public-products"] });
    },
    onError: (error) => {
      safeError("admin.products.createFailed", error);
    },
  });
}

/**
 * Hook for updating a product
 */
export function useUpdateProduct() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("update_product_admin", async ({ id, data: productData }: { id: string; data: Partial<ProductAdmin> }) => {
      const { error } = await aisha.rpc("update_product_admin", {
        p_badge_key: productData.badge_key !== null ? productData.badge_key : undefined,
        p_base_locale: productData.base_locale !== null ? productData.base_locale : undefined,
        p_benefits_content: productData.benefits_content ? toJson(productData.benefits_content) : undefined,
        p_benefits_title_key: productData.benefits_title_key !== null ? productData.benefits_title_key : undefined,
        p_category: productData.category !== null ? productData.category : undefined,
        p_compare_at_price: productData.compare_at_price !== null ? productData.compare_at_price : undefined,
        p_composition_title_key: productData.composition_title_key !== null ? productData.composition_title_key : undefined,
        p_default_protocol_id: productData.default_protocol_id !== null ? productData.default_protocol_id : undefined,
        p_description: productData.description !== null ? productData.description : undefined,
        p_description_key: productData.description_key !== null ? productData.description_key : undefined,
        p_doses_per_package: productData.doses_per_package !== null ? productData.doses_per_package : undefined,
        p_id: id,
        p_image_alt_key: productData.image_alt_key !== null ? productData.image_alt_key : undefined,
        p_image_url: productData.image_url !== null ? productData.image_url : undefined,
        p_images: productData.images !== undefined ? toJson(productData.images ?? []) : undefined,
        p_in_stock: productData.in_stock !== null ? productData.in_stock : undefined,
        p_name: productData.name !== null ? productData.name : undefined,
        p_name_key: productData.name_key !== null ? productData.name_key : undefined,
        p_origin_content: productData.origin_content ? toJson(productData.origin_content) : undefined,
        p_price: productData.price !== null ? productData.price : undefined,
        p_short_description: productData.short_description !== null ? productData.short_description : undefined,
        p_short_description_key: productData.short_description_key !== null ? productData.short_description_key : undefined,
        p_slug: productData.slug !== null ? productData.slug : undefined,
        p_stock_quantity: productData.stock_quantity !== null ? productData.stock_quantity : undefined,
        p_substances_content: productData.substances_content ? toJson(productData.substances_content) : undefined,
        p_tagline_key: productData.tagline_key !== null ? productData.tagline_key : undefined,
        p_target_audience: productData.target_audience !== null ? productData.target_audience : undefined,
        p_usage_content: productData.usage_content ? toJson(productData.usage_content) : undefined,
        p_usage_title_key: productData.usage_title_key !== null ? productData.usage_title_key : undefined,
        p_use_case: productData.use_case !== null ? productData.use_case : undefined,
      });
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      queryClient.invalidateQueries({ queryKey: ["public-products"] });
    },
    onError: (error) => {
      safeError("admin.products.updateFailed", error);
    },
  });
}

/**
 * Hook for deleting a product
 */
export function useDeleteProduct() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("delete_product_admin", async (id: string) => {
      const { error } = await aisha.rpc("delete_product_admin", { p_id: id });
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
    },
    onError: (error) => {
      safeError("admin.products.deleteFailed", error);
    },
  });
}
