import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { toast } from "sonner";

/**
 * Featured product admin data from database
 */
export interface FeaturedProductAdmin {
  id: string;
  product_id: string;
  product_name: string;
  product_slug: string;
  product_price: number;
  badge_key: string;
  title_key: string;
  subtitle_key: string | null;
  feature_keys: string[];
  cta_text_key: string;
  cta_url: string | null;
  price_period_days: number;
  show_price: boolean;
  image_url: string | null;
  background_gradient: string;
  display_location: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Payload for creating/updating featured product
 */
export interface FeaturedProductPayload {
  id?: string;
  product_id?: string;
  badge_key?: string;
  title_key?: string;
  subtitle_key?: string | null;
  feature_keys?: string[];
  cta_text_key?: string;
  cta_url?: string | null;
  price_period_days?: number;
  show_price?: boolean;
  image_url?: string | null;
  background_gradient?: string;
  display_location?: string;
  sort_order?: number;
  is_active?: boolean;
}

const QUERY_KEY = ["admin-featured-products"];

/**
 * Hook for admin management of featured products
 *
 * @returns Query result with CRUD operations
 */
export function useAdminFeaturedProducts() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_featured_products_admin");

      if (error) throw new Error(error.message);
      return (data ?? []) as FeaturedProductAdmin[];
    },
    staleTime: 60 * 1000, // 1 minute
  });

  const createMutation = useMutation({
    mutationFn: async (payload: FeaturedProductPayload) => {
      const { data, error } = await aisha.rpc("upsert_featured_product_admin", {
        p_background_gradient: payload.background_gradient ?? undefined,
        p_badge_key: payload.badge_key ?? undefined,
        p_cta_text_key: payload.cta_text_key ?? undefined,
        p_cta_url: payload.cta_url ?? undefined,
        p_display_location: payload.display_location ?? undefined,
        p_feature_keys: payload.feature_keys ?? undefined,
        p_id: undefined,
        p_image_url: payload.image_url ?? undefined,
        p_is_active: payload.is_active ?? undefined,
        p_price_period_days: payload.price_period_days ?? undefined,
        p_product_id: payload.product_id ?? undefined,
        p_show_price: payload.show_price ?? undefined,
        p_sort_order: payload.sort_order ?? undefined,
        p_subtitle_key: payload.subtitle_key ?? undefined,
        p_title_key: payload.title_key ?? undefined,
      });

      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["featured-products"] });
      toast.success("Featured product created");
    },
    onError: (error) => {
      toast.error(`Failed to create: ${error.message}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: FeaturedProductPayload & { id: string }) => {
      const { data, error } = await aisha.rpc("upsert_featured_product_admin", {
        p_background_gradient: payload.background_gradient ?? undefined,
        p_badge_key: payload.badge_key ?? undefined,
        p_cta_text_key: payload.cta_text_key ?? undefined,
        p_cta_url: payload.cta_url ?? undefined,
        p_display_location: payload.display_location ?? undefined,
        p_feature_keys: payload.feature_keys ?? undefined,
        p_id: payload.id,
        p_image_url: payload.image_url ?? undefined,
        p_is_active: payload.is_active ?? undefined,
        p_price_period_days: payload.price_period_days ?? undefined,
        p_product_id: payload.product_id ?? undefined,
        p_show_price: payload.show_price ?? undefined,
        p_sort_order: payload.sort_order ?? undefined,
        p_subtitle_key: payload.subtitle_key ?? undefined,
        p_title_key: payload.title_key ?? undefined,
      });

      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["featured-products"] });
      toast.success("Featured product updated");
    },
    onError: (error) => {
      toast.error(`Failed to update: ${error.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await aisha.rpc("delete_featured_product_admin", {
        p_id: id,
      });

      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["featured-products"] });
      toast.success("Featured product deleted");
    },
    onError: (error) => {
      toast.error(`Failed to delete: ${error.message}`);
    },
  });

  return {
    featuredProducts: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    create: createMutation.mutate,
    update: updateMutation.mutate,
    remove: deleteMutation.mutate,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
