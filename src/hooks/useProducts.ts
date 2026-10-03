import { useQuery, queryOptions } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { getUserFacingDataErrorMessage } from "@/lib/security/userFacingErrors";
import { getI18nPrimaryLocale } from "@/lib/i18n/locale";
import { z } from "zod";

// Zod schema for public product RPC response (alphabetical order)
const publicProductSchema = z.object({
  archive_document_id: z.string(),
  base_locale: z.string(),
  badge: z.string(),
  benefits_content: z.unknown().nullable(),
  benefits_title: z.string(),
  category: z.string(),
  compare_at_price: z.number(),
  composition_title: z.string(),
  created_at: z.string(),
  description: z.string(),
  id: z.string().uuid(),
  image_alt: z.string(),
  image_url: z.string(),
  images: z.array(z.string()).or(z.null()).default([]),
  in_stock: z.boolean(),
  membership_tier_required: z.string(),
  name: z.string(),
  origin_content: z.unknown().nullable(),
  original_price: z.number(),
  price: z.number(),
  requires_membership: z.boolean(),
  short_description: z.string(),
  slug: z.string(),
  stock_quantity: z.number(),
  substances_content: z.unknown().nullable(),
  tagline: z.string(),
  target_audience: z.string().nullable(),
  updated_at: z.string(),
  usage_content: z.unknown().nullable(),
  usage_title: z.string(),
  use_case: z.string().nullable(),
});

const publicProductArraySchema = z.array(publicProductSchema);

type PublicProductRpc = z.infer<typeof publicProductSchema>;

/**
 * Represents a product available in the shop.
 */
export interface Product {
  /** Unique identifier for the product */
  id: string;
  /** Display name of the product */
  name: string;
  /** URL-friendly slug */
  slug: string;
  /** Full description of the product */
  description: string;
  /** Short summary description */
  short_description: string;
  /** Current selling price */
  price: number;
  /** Original price before discounts */
  original_price: number;
  /** List of image URLs */
  images: string[];
  /** Product category */
  category: string;
  /** Quantity currently in stock */
  stock_quantity: number;
  /** Whether a specific membership is required to purchase */
  requires_membership: boolean;
  /** The required membership tier (if any) */
  membership_tier_required: string;
  /** Price to compare against (for sales) */
  compare_at_price: number;
  /** Main image URL */
  image_url: string;
  /** ID of the associated archive document */
  archive_document_id: string;
  /** Base locale used for translation fallback */
  base_locale: string;
  /** Whether the product is in stock */
  in_stock: boolean;
  /** Target audience for the product */
  target_audience: string | null;
  /** Primary use case */
  use_case: string | null;
  /** Timestamp of creation */
  created_at: string;
  /** Timestamp of last update */
  updated_at: string;
  
  // Marketing fields (localized by RPC based on p_locale)
  /** Badge text (e.g., "New", "Premium Peptides") */
  badge: string;
  /** Short tagline for the product */
  tagline: string;
  /** Alt text for the main image */
  image_alt: string;
  /** Title for the benefits section */
  benefits_title: string;
  /** Title for the composition section */
  composition_title: string;
  /** Title for the usage section */
  usage_title: string;
  /** Structured content for product origin/provenance */
  origin_content: unknown | null;
  /** Structured content for product benefits */
  benefits_content: unknown | null;
  /** Structured content for product substances/ingredients */
  substances_content: unknown | null;
  /** Structured content for usage instructions */
  usage_content: unknown | null;
}

/**
 * Maps RPC response to Product type with safe defaults
 */
function mapRpcToProduct(p: PublicProductRpc): Product {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    short_description: p.short_description,
    price: p.price,
    original_price: p.original_price || p.price,
    images: Array.isArray(p.images) ? p.images : [],
    category: p.category,
    stock_quantity: p.stock_quantity,
    requires_membership: p.requires_membership,
    membership_tier_required: p.membership_tier_required,
    compare_at_price: p.compare_at_price,
    image_url: p.image_url,
    archive_document_id: p.archive_document_id,
    base_locale: p.base_locale,
    in_stock: p.in_stock,
    target_audience: p.target_audience,
    use_case: p.use_case,
    created_at: p.created_at,
    updated_at: p.updated_at,
    // Marketing fields
    badge: p.badge ?? "",
    tagline: p.tagline ?? "",
    image_alt: p.image_alt ?? "",
    benefits_title: p.benefits_title ?? "",
    composition_title: p.composition_title ?? "",
    usage_title: p.usage_title ?? "",
    origin_content: p.origin_content,
    benefits_content: p.benefits_content,
    substances_content: p.substances_content,
    usage_content: p.usage_content,
  };
}

/**
 * Query options for fetching all products
 */
export const productsQueryOptions = (locale: string = "en") => queryOptions({
  queryKey: ["public-products", locale],
  queryFn: async (): Promise<Product[]> => {
    const { data, error: rpcError } = await aisha.rpc("get_public_products", {
      p_locale: locale,
    });

    if (rpcError) {
      safeError("products.fetch", rpcError);
      throw rpcError;
    }

    // Validate with Zod
    const validated = publicProductArraySchema.parse(data ?? []);
    return validated.map(mapRpcToProduct);
  },
  staleTime: 5 * 60 * 1000, // 5 minutes
});

/**
 * Hook to fetch all public products.
 * 
 * @returns Object containing the list of products, loading state, and error state.
 */
export function useProducts() {
  const { i18n } = useTranslation();
  const locale = getI18nPrimaryLocale(i18n.language);
  const query = useQuery(productsQueryOptions(locale));

  return {
    products: query.data ?? [],
    loading: query.isLoading,
    error: query.error ? getUserFacingDataErrorMessage(query.error) : null
  };
}

/**
 * Query options for fetching a single product
 */
export const productQueryOptions = (slug: string, locale: string = "en") => queryOptions({
  queryKey: ["public-product", slug, locale],
  queryFn: async (): Promise<Product | null> => {
    if (!slug) return null;

    const { data, error: rpcError } = await aisha.rpc("get_public_product_by_slug", {
      p_locale: locale
,
      p_slug: slug
    });

    if (rpcError) {
      safeError("product.fetchBySlug", rpcError);
      throw rpcError;
    }

    if (data && Array.isArray(data) && data.length > 0) {
      // Validate single product
      const validated = publicProductSchema.parse(data[0]);
      return mapRpcToProduct(validated);
    }

    return null;
  },
  enabled: !!slug,
  staleTime: 5 * 60 * 1000,
});

/**
 * Hook to fetch a single product by its slug.
 *
 * @param slug - The URL-friendly slug of the product.
 * @returns Object containing the product, loading state, and error state.
 */
export function useProduct(slug: string) {
  const { i18n } = useTranslation();
  const locale = getI18nPrimaryLocale(i18n.language);
  const query = useQuery(productQueryOptions(slug, locale));

  return {
    product: query.data ?? null,
    loading: query.isLoading,
    error: query.error ? getUserFacingDataErrorMessage(query.error) : null
  };
}
