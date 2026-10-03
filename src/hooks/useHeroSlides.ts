import { useQuery, queryOptions } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useTranslation } from "react-i18next";
import { safeError } from "@/lib/security/safeLogger";
import { HeroSlidePublicSchema, parseRpcArrayResponse } from "@/schemas/rpcResponseSchemas";
import { getI18nPrimaryLocale } from "@/lib/i18n/locale";

export interface HeroSlide {
  id: string;
  title: string;
  subtitle: string;
  badge: string;
  targetAudience: string;
  backgroundImageUrl: string;
  backgroundGradient: string;
  ctaText: string;
  ctaUrl: string;
  linkedProductId: string | null;
  linkedProductName: string;
  linkedProductPrice: number;
  linkedProductSlug: string;
  sortOrder: number;
  circleIcon: string;
  circleText: string;
}

async function fetchHeroSlides(lang: string): Promise<HeroSlide[]> {
  const { data, error } = await aisha.rpc("get_public_hero_slides", {
    p_locale: lang,
  });

  if (error) {
    safeError("hero-slides.fetch", error);
    throw new Error(error.message);
  }

  const validated = parseRpcArrayResponse(HeroSlidePublicSchema, data);

  return validated.map((slide) => ({
    id: slide.id,
    title: slide.title,
    subtitle: slide.subtitle,
    badge: slide.badge,
    targetAudience: slide.target_audience,
    backgroundImageUrl: slide.background_image_url,
    backgroundGradient: slide.background_gradient,
    ctaText: slide.cta_text,
    ctaUrl: slide.cta_url,
    linkedProductId: slide.linked_product_id,
    linkedProductName: slide.linked_product_name,
    linkedProductPrice: slide.linked_product_price,
    linkedProductSlug: slide.linked_product_slug,
    sortOrder: slide.sort_order ?? 0,
    circleIcon: slide.circle_icon,
    circleText: slide.circle_text,
  }));
}

/**
 * Query options for hero slides — can be used with `queryClient.ensureQueryData`
 * to prefetch hero slides in the route loader.
 */
export function heroSlidesQueryOptions(lang: string) {
  return queryOptions({
    queryKey: ["hero-slides", lang],
    queryFn: () => fetchHeroSlides(lang),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useHeroSlides() {
  const { i18n } = useTranslation();
  const lang = getI18nPrimaryLocale(i18n.language);

  return useQuery(heroSlidesQueryOptions(lang));
}
