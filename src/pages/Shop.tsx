import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { Leaf, FlaskConical, ArrowRight, Info, ImageOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useProducts } from "@/hooks/useProducts";
import { PriceDisplay } from "@/components/common/PriceDisplay";

export default function Shop() {
  const { t } = useTranslation();
  const { products, loading, error } = useProducts();

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main>
        {/* Hero - pt-24 ensures content is below fixed header */}
        <section className="pt-24 pb-16 bg-card border-b border-border">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 pt-8">
            <div className="max-w-3xl">
              <span className="text-sm font-medium uppercase tracking-wider text-accent mb-4 block">
                {t('shop.sectionLabel')}
              </span>
              <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl font-bold text-foreground mb-6">
                {t('shop.productsTitle')}
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed mb-8">
                {t('shop.productsSubtitle')}
              </p>
              <div className="flex items-center gap-6 text-sm text-muted-foreground">
                <span className="flex items-center gap-2">
                  <Leaf className="h-4 w-4 text-secondary" />
                  {t('shop.cleanIngredients')}
                </span>
                <span className="flex items-center gap-2">
                  <FlaskConical className="h-4 w-4 text-primary" />
                  {t('shop.euCompliant')}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Pre-order Notice */}
        <section className="py-6 bg-muted/50 border-b border-border">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-start gap-3 max-w-3xl">
              <Info className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
              <p className="text-sm text-muted-foreground">
                {t('shop.preorderNotice')}
              </p>
            </div>
          </div>
        </section>

        {/* Products Grid */}
        <section className="py-24">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            {error && (
              <Alert className="mb-8">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="bg-card border border-border rounded-lg overflow-hidden">
                    <Skeleton className="aspect-[4/3] w-full" />
                    <div className="p-6 space-y-3">
                      <Skeleton className="h-6 w-2/3" />
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : products.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                {t('shop.noProducts')}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {products.map((product) => (
                  <article
                    key={product.id}
                    className="group bg-card border border-border rounded-lg overflow-hidden hover:shadow-lg transition-all duration-300"
                  >
                    {/* Image */}
                    <div className="aspect-[4/3] bg-muted relative overflow-hidden">
                      {product.image_url ? (
                        <img
                          src={product.image_url}
                          alt={product.name || ""}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                          <ImageOff className="h-10 w-10 opacity-60" />
                        </div>
                      )}
                      <div className="absolute top-4 left-4 flex gap-2">
                        <Badge variant="default" className="bg-primary/90">
                          {t('shop.membersOnly')}
                        </Badge>
                        {product.category && (
                          <Badge variant="secondary">
                            {product.category}
                          </Badge>
                        )}
                        {product.in_stock === false && (
                          <Badge variant="secondary">{t('shop.outOfStock')}</Badge>
                        )}
                      </div>
                    </div>

                    {/* Content */}
                    <div className="p-6">
                      <div className="mb-4">
                        <h3 className="font-serif text-2xl font-bold text-foreground mb-1">
                          {product.name}
                        </h3>
                        {product.short_description && (
                          <p className="text-muted-foreground">
                            {product.short_description}
                          </p>
                        )}
                        <p className="mt-2 font-medium">
                          <PriceDisplay amount={product.price} />
                        </p>
                      </div>

                      {product.description && (
                        <p className="text-muted-foreground text-sm mb-6 line-clamp-3">
                          {product.description}
                        </p>
                      )}

                      <Button
                        className="w-full"
                        variant="outline"
                        asChild
                      >
                        <Link to={`/shop/${product.slug}`}>
                          {t('shop.viewProduct')}
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Bridge Section */}
        <section className="py-16 bg-primary text-primary-foreground">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto text-center">
              <h2 className="font-serif text-2xl sm:text-3xl font-bold mb-4">
                {t('shop.bridgeTitle')}
              </h2>
              <p className="text-lg opacity-90 leading-relaxed mb-6">
                {t('shop.bridgeSubtitle')}
              </p>
              <Button variant="secondary" asChild>
                <Link to="/whitepaper">
                  {t('shop.methodsStandards')}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Membership CTA */}
        <section className="py-16 bg-card border-t border-border">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto text-center">
              <h2 className="font-serif text-2xl sm:text-3xl font-bold text-foreground mb-4">
                {t('shop.membershipCtaTitle')}
              </h2>
              <p className="text-muted-foreground mb-6">
                {t('shop.membershipCtaDescription')}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button asChild>
                  <Link to="/qualification-test">
                    {t('shop.becomeMember')}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link to="/studies">
                    {t('shop.exploreStudies')}
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Compliance Note */}
        <section className="py-12 bg-muted/50 border-t border-border">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto text-center">
              <p className="text-sm text-muted-foreground">
                {t('shop.complianceNote')}
              </p>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
