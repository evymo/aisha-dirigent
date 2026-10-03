import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Package, Loader2 } from "lucide-react";
import { PriceDisplay } from "@/components/common/PriceDisplay";
import { usePublicProducts } from "@/hooks/usePublicProducts";
import { useScrollReveal, getStaggerDelay } from "@/hooks/useScrollReveal";

export function PublicProductsSection() {
  const { t } = useTranslation();
  const { data: products = [], isLoading } = usePublicProducts();
  const { ref: headerRef, isVisible: headerVisible } = useScrollReveal();
  const { ref: gridRef, isVisible: gridVisible } = useScrollReveal();

  // Show max 4 featured products
  const displayProducts = products.slice(0, 4);

  if (isLoading) {
    return (
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4 flex justify-center">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">{t('common.loading')}</span>
          </div>
        </div>
      </section>
    );
  }

  if (displayProducts.length === 0) {
    return null;
  }

  return (
    <section className="py-16 md:py-24">
      <div className="container mx-auto px-4">
        {/* Header */}
        <div
          ref={headerRef}
          className={`flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10 reveal-fade-up ${headerVisible ? 'reveal-visible' : 'reveal-hidden'}`}
        >
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full badge-shimmer text-secondary-foreground text-xs font-medium uppercase tracking-wider mb-4 border border-secondary/20">
              <Package className="h-3.5 w-3.5" />
              {t('landing.products.label')}
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl font-semibold text-foreground">
              {t('landing.products.title')}
            </h2>
            <p className="mt-3 text-muted-foreground text-lg max-w-xl">
              {t('landing.products.subtitle')}
            </p>
          </div>
          <Button variant="outline" asChild className="hidden sm:inline-flex rounded-full px-6 self-end hover:bg-primary/10 hover:border-primary transition-all">
            <Link to="/shop">
              {t('landing.products.viewAll')}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>

        {/* Products Grid */}
        <div ref={gridRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          {displayProducts.map((product, index) => (
            <Link
              key={product.id}
              to={`/shop/${product.slug}`}
              className={`group flex flex-col p-5 md:p-6 bg-card rounded-2xl border border-border/40 card-hover-glow elevation-1 reveal-fade-up ${gridVisible ? 'reveal-visible' : 'reveal-hidden'}`}
              style={getStaggerDelay(index)}
            >
              {/* Image */}
              <div className="aspect-square rounded-xl bg-muted/50 mb-4 flex items-center justify-center overflow-hidden">
                {product.image_url ? (
                  <img
                    src={product.image_url}
                    alt={product.name}
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <Package className="h-12 w-12 text-muted-foreground/50" />
                )}
              </div>

              {/* Category badge */}
              {product.category && (
                <Badge variant="secondary" className="self-start mb-2 rounded-full text-xs">
                  {product.category}
                </Badge>
              )}

              {/* Name */}
              <h3 className="font-semibold text-lg text-foreground group-hover:text-primary transition-colors mb-1">
                {product.name}
              </h3>

              {/* Short description */}
              {product.short_description && (
                <p className="text-sm text-muted-foreground line-clamp-2 mb-3 flex-grow">
                  {product.short_description}
                </p>
              )}

              {/* Price */}
              <div className="flex items-center justify-between pt-3 border-t border-border/40">
                <span className="font-semibold text-lg text-foreground">
                  <PriceDisplay amount={product.price} />
                </span>
                <span className="text-sm text-primary opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  {t('common.viewDetails')} <ArrowRight className="inline h-3.5 w-3.5 ml-0.5" />
                </span>
              </div>
            </Link>
          ))}
        </div>

        {/* Mobile CTA */}
        <div className="mt-8 sm:hidden">
          <Button variant="outline" asChild className="w-full rounded-full">
            <Link to="/shop">
              {t('landing.products.viewAll')}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
