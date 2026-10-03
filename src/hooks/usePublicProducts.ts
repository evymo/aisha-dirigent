import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { productsQueryOptions, type Product } from "@/hooks/useProducts";
import { getI18nPrimaryLocale } from "@/lib/i18n/locale";

export interface PublicProduct {
  id: string;
  name: string;
  slug: string;
  short_description: string;
  price: number;
  category: string;
  image_url: string;
  target_audience: string | null;
  use_case: string | null;
}

const toPublicProduct = (product: Product): PublicProduct => ({
  id: product.id,
  name: product.name,
  slug: product.slug,
  short_description: product.short_description,
  price: product.price,
  category: product.category,
  image_url: product.image_url,
  target_audience: product.target_audience,
  use_case: product.use_case,
});

/**
 * Hook to fetch a lightweight public product catalog.
 */
export function usePublicProducts() {
  const { i18n } = useTranslation();
  const locale = getI18nPrimaryLocale(i18n.language);

  const queryOptions = productsQueryOptions(locale);

  return useQuery({
    ...queryOptions,
    select: (products) => products.map(toPublicProduct),
  });
}
