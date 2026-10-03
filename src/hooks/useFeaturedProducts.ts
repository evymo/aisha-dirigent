import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";

/**
 * Featured product data from database
 */
export interface FeaturedProduct {
  id: string;
  product_id: string;
  product_name: string;
  product_slug: string;
  product_price: number;
  product_currency: string;
  badge_key: string;
  title_key: string;
  subtitle_key: string | null;
  feature_keys: string[];
  cta_text_key: string;
  cta_url: string;
  price_period_days: number;
  show_price: boolean;
  image_url: string | null;
  background_gradient: string;
  sort_order: number;
}

/**
 * Hook to fetch featured products for a specific location
 * 
 * @param location - Display location (default: 'homepage')
 * @returns Query result with featured products array
 * 
 * @example
 * ```tsx
 * const { data: featured, isLoading } = useFeaturedProducts('homepage');
 * ```
 */
export function useFeaturedProducts(location: string = 'homepage') {
  return useQuery({
    queryKey: ['featured-products', location],
    queryFn: async () => {
      const { data, error } = await aisha.rpc('get_featured_products', {
        p_location: location
      });

      if (error) throw new Error(error.message);
      return (data ?? []) as FeaturedProduct[];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to get the first (primary) featured product for homepage
 * 
 * @returns Query result with single featured product or null
 */
export function usePrimaryFeaturedProduct() {
  const query = useFeaturedProducts('homepage');
  
  return {
    ...query,
    data: query.data?.[0] ?? null,
  };
}
