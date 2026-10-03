import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Check, ArrowRight, Loader2 } from "lucide-react";
import { PriceDisplay } from "@/components/common/PriceDisplay";
import { usePrimaryFeaturedProduct } from "@/hooks/useFeaturedProducts";
import { useDynamicTranslationsMap } from "@/hooks/useDynamicTranslations";
import { useScrollReveal, getStaggerDelay } from "@/hooks/useScrollReveal";

const TRANSLATION_NAMESPACE = "featured";

/**
 * Featured product highlight section for homepage.
 * Data is loaded from database via `featured_products` table.
 * Translations are loaded dynamically from DB `translations` table.
 */
export function FeaturedProductHighlight() {
  const { t } = useTranslation();
  const { data: featured, isLoading, error } = usePrimaryFeaturedProduct();
  const { ref: sectionRef, isVisible } = useScrollReveal();

  // Gather all translation keys from featured product
  const translationKeys = featured
    ? [
      featured.badge_key,
      featured.title_key,
      featured.subtitle_key,
      featured.cta_text_key,
      ...featured.feature_keys,
    ].filter(Boolean) as string[]
    : [];

  // Load translations from DB — hook returns Record<string, string> (key → value for current locale)
  const translationsData = useDynamicTranslationsMap(translationKeys, TRANSLATION_NAMESPACE, "en");

  // Helper to get translation from DB (no static fallback)
  const getTranslation = (key: string | null | undefined): string => {
    if (!key) return "";
    return translationsData[key] ?? "";
  };

  // Don't render if no featured product or error
  if (error || (!isLoading && !featured)) {
    return null;
  }

  // Loading state
  if (isLoading) {
    return (
      <section className="py-16 md:py-24 bg-gradient-to-br from-primary/5 via-primary/10 to-secondary/10">
        <div className="container mx-auto px-4">
          <div className="max-w-5xl mx-auto flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        </div>
      </section>
    );
  }

  // Guard: featured is guaranteed non-null after loading/error checks above
  if (!featured) return null;

  // Translate feature keys
  const features = featured.feature_keys.map(key => getTranslation(key)).filter(Boolean);

  return (
    <section className={`py-16 md:py-24 bg-gradient-to-br ${featured.background_gradient}`}>
      <div className="container mx-auto px-4">
        <div ref={sectionRef} className="max-w-5xl mx-auto">
          <div className={`flex flex-col md:flex-row gap-8 md:gap-12 items-center p-8 md:p-12 bg-card rounded-3xl border border-primary/20 elevation-3 reveal-fade-scale ${isVisible ? 'reveal-visible' : 'reveal-hidden'}`}>
            {/* Product image */}
            <div className="flex-shrink-0 w-48 h-48 md:w-64 md:h-64 rounded-2xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center overflow-hidden animate-float-slow">
              {featured.image_url ? (
                <img
                  src={featured.image_url}
                  alt={getTranslation(featured.title_key)}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              ) : (
                <Sparkles className="w-20 h-20 md:w-24 md:h-24 text-primary" />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 text-center md:text-left">
              <Badge variant="outline" className="mb-4 rounded-full badge-shimmer border-secondary text-foreground">
                {getTranslation(featured.badge_key)}
              </Badge>

              <h2 className="font-serif text-2xl md:text-3xl lg:text-4xl font-semibold text-foreground mb-3">
                {getTranslation(featured.title_key)}
              </h2>

              {featured.subtitle_key && (
                <p className="text-muted-foreground text-lg mb-6">
                  {getTranslation(featured.subtitle_key)}
                </p>
              )}

              {/* Features — staggered reveal */}
              {features.length > 0 && (
                <ul className="space-y-2 mb-8">
                  {features.map((feature, index) => (
                    <li
                      key={index}
                      className={`flex items-center gap-3 text-foreground reveal-fade-up ${isVisible ? 'reveal-visible' : 'reveal-hidden'}`}
                      style={getStaggerDelay(index + 2, 120)}
                    >
                      <Check className="h-5 w-5 text-primary flex-shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              )}

              {/* Price and CTA */}
              <div className="flex flex-col sm:flex-row items-center gap-4">
                {featured.show_price && (
                  <div className="text-center sm:text-left">
                    <PriceDisplay
                      amount={featured.product_price}
                      forceCurrency={featured.product_currency}
                      size="lg"
                      className="text-foreground"
                    />
                    {featured.price_period_days && (
                      <span className="text-muted-foreground ml-2">
                        / {featured.price_period_days} {t('common.days.dayCount', { count: featured.price_period_days })}
                      </span>
                    )}
                  </div>
                )}
                <Button size="lg" asChild className="rounded-full px-8 text-foreground btn-pulse-glow">
                  <Link to={featured.cta_url}>
                    {getTranslation(featured.cta_text_key)}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
