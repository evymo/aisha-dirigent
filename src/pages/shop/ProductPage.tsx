import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ProductReviews } from "@/components/products/ProductReviews";
import { ProductDistributionInfo } from "@/components/products/ProductDistributionInfo";
import { useProduct } from "@/hooks/useProducts";
import { useSession } from "@/hooks/useSession";
import { usePermissions } from "@/hooks/usePermissions";
import { useHasInformedConsent } from "@/hooks/useInformedConsent";
import { useCart } from "@/hooks/useCart";
import { useDynamicTranslationsMap, SUPPORTED_LOCALES, type SupportedLocale } from "@/hooks/useDynamicTranslations";
import { ArrowLeft, ImageOff, ShoppingBag, GraduationCap, FileSignature, Leaf, Zap, Activity, Info, Shield } from "lucide-react";
import { ProductTransparencySection } from "@/components/transparency";


import { PriceDisplay } from "@/components/common/PriceDisplay";

const MARKETING_KEY_PATTERN = /^[a-z0-9_.:-]+$/i;

const looksLikeMarketingKey = (value: string) =>
  value.startsWith("products.") && MARKETING_KEY_PATTERN.test(value);

const collectMarketingKeys = (value: unknown, keys: Set<string>) => {
  if (typeof value === "string") {
    if (looksLikeMarketingKey(value)) {
      keys.add(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectMarketingKeys(item, keys));
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) =>
      collectMarketingKeys(item, keys)
    );
  }
};

const resolveMarketingContent = (
  value: unknown,
  translations: Record<string, string>
): unknown => {
  if (typeof value === "string") {
    if (looksLikeMarketingKey(value) && translations[value]) {
      return translations[value];
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveMarketingContent(item, translations));
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    Object.entries(obj).forEach(([key, val]) => {
      out[key] = resolveMarketingContent(val, translations);
    });
    return out;
  }
  return value;
};

/**
 * Renders marketing content from JSONB structure.
 * Supports various content formats: paragraphs, lists, key-value items.
 */
function MarketingSection({ content, title }: { content: unknown, title?: string }) {
  const { t } = useTranslation();
  if (!content || typeof content !== "object") return null;

  // Handle array of content items
  if (Array.isArray(content)) {
    return (
      <div className="space-y-4">
        {title && <h3 className="font-serif text-2xl font-semibold mb-4">{title}</h3>}
        {content.map((item, idx) => (
          <MarketingSectionItem key={idx} item={item} />
        ))}
      </div>
    );
  }

  // Handle object with text/title/items structure
  const obj = content as Record<string, unknown>;

  // Type guard helpers
  const getString = (val: unknown): string | null =>
    typeof val === "string" ? val : null;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {title && <h3 className="font-serif text-2xl font-semibold text-foreground">{title}</h3>}
        {getString(obj.title) && !title && (
          <h3 className="font-semibold text-lg text-foreground">{getString(obj.title)}</h3>
        )}
        {getString(obj.description) && (
          <p className="text-muted-foreground whitespace-pre-line leading-relaxed text-lg">{getString(obj.description)}</p>
        )}
        {getString(obj.text) && (
          <p className="text-muted-foreground whitespace-pre-line leading-relaxed">{getString(obj.text)}</p>
        )}
      </div>

      {/* Specific handling for Origin/Source/Production structure */}
      {(!!obj.source || !!obj.production) && (
        <div className="grid gap-6 md:grid-cols-2">
          {!!obj.source && typeof obj.source === 'object' && (
            <div className="bg-gradient-to-br from-background to-muted/20 p-6 rounded-xl border border-border/40 hover:shadow-sm transition-all">
              <h4 className="font-medium mb-3 flex items-center gap-2 text-primary">
                <Leaf className="h-4 w-4" />
                {getString((obj.source as Record<string, unknown>).title) || t('shop.originSource')}
              </h4>
              <p className="text-muted-foreground leading-relaxed">{getString((obj.source as Record<string, unknown>).description)}</p>
            </div>
          )}
          {!!obj.production && typeof obj.production === 'object' && (
            <div className="bg-gradient-to-br from-background to-muted/20 p-6 rounded-xl border border-border/40 hover:shadow-sm transition-all">
              <h4 className="font-medium mb-3 flex items-center gap-2 text-blue-500">
                <Activity className="h-4 w-4" />
                {getString((obj.production as Record<string, unknown>).title) || t('shop.originProduction')}
              </h4>
              <p className="text-muted-foreground leading-relaxed">{getString((obj.production as Record<string, unknown>).description)}</p>
            </div>
          )}
        </div>
      )}

      {/* Specific handling for Benefits object structure (key-value pairs of objects) */}
      {!Array.isArray(obj) && !obj.items && !obj.substances && !obj.source && Object.keys(obj).length > 0 &&
        Object.values(obj).every(v => typeof v === 'object' && v !== null && 'title' in v) && (
          <div className="grid gap-6 sm:grid-cols-2">
            {Object.entries(obj).map(([key, val]) => (
              <MarketingSectionItem key={key} item={val} highlight />
            ))}
          </div>
        )}


      {Array.isArray(obj.items) && (
        <ul className="list-disc list-inside space-y-2 text-muted-foreground pl-4">
          {obj.items.map((li, i) => (
            <li key={i}>{typeof li === "string" ? li : JSON.stringify(li)}</li>
          ))}
        </ul>
      )}
      {/* Substances Map/List */}
      {(!!obj.substances || !!obj.items) && !Array.isArray(obj.items) && (
        <div className="bg-card border border-border/40 rounded-xl overflow-hidden">
          {!!obj.substances && typeof obj.substances === 'object' && Object.entries(obj.substances as Record<string, unknown>).map(([key, val], idx, arr) => (
            <div key={key} className={`flex flex-col sm:flex-row gap-2 sm:gap-8 text-sm p-4 ${idx !== arr.length - 1 ? 'border-b border-border/40' : ''}`}>
              <span className="font-medium min-w-[150px] text-foreground/80 sm:text-right">{key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1').trim()}</span>
              <span className="text-muted-foreground flex-1">{String(val)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Usage specific structure */}
      {(!!obj.distribution || !!obj.storage || !!obj.application) && (
        <div className="grid gap-6 sm:grid-cols-1">
          {['application', 'distribution', 'storage', 'warning', 'chronic', 'note', 'synergy'].map(key => {
            const item = obj[key] as Record<string, unknown> | undefined;
            if (!item) return null;
            return (
              <div key={key} className="bg-muted/10 p-5 rounded-lg border border-border/20">
                <h4 className="font-semibold mb-2 text-foreground flex items-center gap-2">
                  <Info className="h-4 w-4 text-primary" />
                  {getString(item.title)}
                </h4>
                <p className="text-muted-foreground leading-relaxed">{getString(item.description)}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  );
}

function MarketingSectionItem({ item, highlight }: { item: unknown, highlight?: boolean }) {
  if (!item) return null;

  if (typeof item === "string") {
    return <p className="text-muted-foreground">{item}</p>;
  }

  if (typeof item !== "object") {
    return <p className="text-muted-foreground">{String(item)}</p>;
  }

  const obj = item as Record<string, unknown>;
  const getString = (val: unknown): string | null =>
    typeof val === "string" ? val : null;

  return (
    <div className={`
      h-full
      ${highlight
        ? 'bg-card border border-border/50 rounded-xl p-6 shadow-sm hover:shadow-md transition-all duration-300 hover:border-primary/20'
        : 'bg-background/50 rounded-md p-3'
      }
    `}>
      {getString(obj.name) && (
        <h4 className="font-medium text-primary mb-2">{getString(obj.name)}</h4>
      )}
      {getString(obj.title) && (
        <h4 className="font-semibold text-lg text-foreground mb-3 flex items-center gap-2">
          {highlight && <Zap className="h-4 w-4 text-amber-500" />}
          {getString(obj.title)}
        </h4>
      )}
      {getString(obj.description) && (
        <p className="text-muted-foreground leading-relaxed">{getString(obj.description)}</p>
      )}
      {getString(obj.text) && (
        <p className="text-muted-foreground mt-1">{getString(obj.text)}</p>
      )}
      {getString(obj.amount) && (
        <p className="text-sm text-primary mt-2 font-mono font-medium">{getString(obj.amount)}</p>
      )}
    </div>
  );
}

// Helper to map product slug to i18n key root
function getProductI18nRoot(slug: string): string | null {
  if (!slug) return null;
  const s = slug.toLowerCase();
  if (s.includes("retisin")) return "retisin";
  if (s.includes("floristen")) return "floristen";
  if (s.includes("lyastin")) return "lyastin";
  // Match "duo" or "rtn-duo"
  if (s.includes("duo")) return "rtnDuo";
  return null;
}

type EnrichedProductContent = {
  name?: string;
  description?: string;
  tagline?: string;
  badge?: string;
  imageAlt?: string;
  benefitsTitle?: string;
  compositionTitle?: string;
  usageTitle?: string;
  origin?: unknown;
  benefits?: unknown;
  substances?: unknown;
  usage?: unknown;
};

export default function ProductPage() {
  const { t, i18n } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const { product, loading, error } = useProduct(slug ?? "");
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const { hasInformedConsent } = useHasInformedConsent();
  const { addToCart } = useCart();

  const productI18nRoot = useMemo(() => slug ? getProductI18nRoot(slug) : null, [slug]);

  // Get localized enriched content if avail
  const enrichedContent = useMemo(() => {
    if (!productI18nRoot) return null;
    const key = `products.${productI18nRoot}`;
    const data = t(key, { returnObjects: true }) as unknown as EnrichedProductContent;
    // Basic validation to ensure we got an object back, not the key string
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
    return data;
  }, [productI18nRoot, t]);

  const marketingKeys = useMemo(() => {
    if (!product) return [];
    const keys = new Set<string>();
    collectMarketingKeys(product.origin_content, keys);
    collectMarketingKeys(product.benefits_content, keys);
    collectMarketingKeys(product.substances_content, keys);
    collectMarketingKeys(product.usage_content, keys);
    return Array.from(keys);
  }, [product]);

  const fallbackLocale = useMemo(() => {
    const baseLocale = product?.base_locale;
    if (baseLocale && (SUPPORTED_LOCALES as readonly string[]).includes(baseLocale)) {
      return baseLocale as SupportedLocale;
    }
    return undefined;
  }, [product?.base_locale]);

  const marketingTranslations = useDynamicTranslationsMap(
    marketingKeys,
    "products",
    fallbackLocale
  );

  const resolvedOrigin = useMemo(
    () => enrichedContent?.origin || resolveMarketingContent(product?.origin_content ?? null, marketingTranslations),
    [product?.origin_content, marketingTranslations, enrichedContent]
  );
  const resolvedBenefits = useMemo(
    () => enrichedContent?.benefits || resolveMarketingContent(product?.benefits_content ?? null, marketingTranslations),
    [product?.benefits_content, marketingTranslations, enrichedContent]
  );
  const resolvedSubstances = useMemo(
    () => enrichedContent?.substances || resolveMarketingContent(product?.substances_content ?? null, marketingTranslations),
    [product?.substances_content, marketingTranslations, enrichedContent]
  );
  const resolvedUsage = useMemo(
    () => enrichedContent?.usage || resolveMarketingContent(product?.usage_content ?? null, marketingTranslations),
    [product?.usage_content, marketingTranslations, enrichedContent]
  );

  // Titles from enriched content or DB
  const benefitsTitle = enrichedContent?.benefitsTitle || product?.benefits_title;
  const compositionTitle = enrichedContent?.compositionTitle || product?.composition_title;
  const usageTitle = enrichedContent?.usageTitle || product?.usage_title;

  // Basic info override
  const displayName = enrichedContent?.name || product?.name;
  const displayDescription = enrichedContent?.description || product?.description;
  const displayTagline = enrichedContent?.tagline || product?.tagline;
  const displayBadge = enrichedContent?.badge || product?.badge;
  const displayImageAlt = enrichedContent?.imageAlt || product?.image_alt || product?.name;

  const isAuthenticated = !!user;
  const isQualifiedMember = hasPermission("order_products");
  const canPurchase = isQualifiedMember && hasInformedConsent;

  const images = useMemo(() => {
    if (!product) return [];
    const productImages = Array.isArray(product.images) ? product.images : [];
    const list = [product.image_url, ...productImages].filter(Boolean) as string[];
    return Array.from(new Set(list));
  }, [product]);

  const [activeImage, setActiveImage] = useState<string | null>(null);

  useEffect(() => {
    setActiveImage(images[0] ?? null);
  }, [images]);

  useEffect(() => {
    if (!product) return;

    const previousTitle = document.title;
    const descriptionTag = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const ogTitleTag = document.querySelector<HTMLMetaElement>('meta[property="og:title"]');
    const ogDescriptionTag = document.querySelector<HTMLMetaElement>('meta[property="og:description"]');

    const previousDescription = descriptionTag?.content ?? null;
    const previousOgTitle = ogTitleTag?.content ?? null;
    const previousOgDescription = ogDescriptionTag?.content ?? null;

    const brand = t("shop.sectionLabel");
    const title = brand ? `${displayName} - ${brand}` : (displayName ?? brand);
    const description = product.short_description || displayDescription || t("shop.productsSubtitle");

    document.title = title;
    if (descriptionTag) descriptionTag.content = description;
    if (ogTitleTag) ogTitleTag.content = title;
    if (ogDescriptionTag) ogDescriptionTag.content = description;

    return () => {
      document.title = previousTitle;
      if (descriptionTag && previousDescription !== null) descriptionTag.content = previousDescription;
      if (ogTitleTag && previousOgTitle !== null) ogTitleTag.content = previousOgTitle;
      if (ogDescriptionTag && previousOgDescription !== null) ogDescriptionTag.content = previousOgDescription;
    };
  }, [product, t, displayName, displayDescription]);

  if (!slug) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 pt-24 pb-16">
          <div className="container mx-auto px-4">
            <Alert>
              <AlertDescription>{t("shop.productNotFound")}</AlertDescription>
            </Alert>
            <div className="mt-6">
              <Button asChild variant="outline">
                <Link to="/shop">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t("shop.backToShop")}
                </Link>
              </Button>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-6">
            <Button asChild variant="ghost" className="pl-0 text-muted-foreground hover:text-foreground">
              <Link to="/shop">
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("shop.backToShop")}
              </Link>
            </Button>
          </div>

          {error && (
            <Alert className="mb-8" variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {loading ? (
            <div className="grid lg:grid-cols-2 gap-10 min-w-0">
              <Skeleton className="aspect-[4/3] w-full rounded-lg" />
              <div className="space-y-4">
                <Skeleton className="h-10 w-2/3" />
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="h-6 w-1/4" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            </div>
          ) : !product ? (
            <Alert>
              <AlertDescription>{t("shop.productNotFound")}</AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="grid lg:grid-cols-2 gap-12 items-start mb-16 min-w-0">
                {/* Images */}
                <div className="space-y-4 sticky top-24">
                  <div className="aspect-[4/3] w-full bg-muted/10 rounded-xl overflow-hidden shadow-sm border border-border/40">
                    {activeImage ? (
                      <img
                        src={activeImage}
                        alt={displayImageAlt}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground bg-muted/20">
                        <ImageOff className="h-12 w-12 opacity-40" />
                      </div>
                    )}
                  </div>

                  {images.length > 1 && (
                    <div className="flex gap-2 overflow-auto pb-2">
                      {images.map((img) => (
                        <button
                          key={img}
                          type="button"
                          className={`h-20 w-24 rounded-lg overflow-hidden border-2 transition-all ${img === activeImage ? "border-primary shadow-sm" : "border-transparent opacity-70 hover:opacity-100"}`}
                          onClick={() => setActiveImage(img)}
                        >
                          <img src={img} alt={product.name} className="h-full w-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Details */}
                <div className="space-y-8">
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {displayBadge && <Badge variant="default" className="text-sm px-3 py-1 bg-primary/90 hover:bg-primary">{displayBadge}</Badge>}
                      {product.category && <Badge variant="secondary" className="text-sm px-3 py-1">{product.category}</Badge>}
                      {product.in_stock === false && <Badge variant="destructive" className="text-sm px-3 py-1">{t("shop.outOfStock")}</Badge>}
                    </div>

                    <h1 className="font-serif text-4xl sm:text-5xl font-bold text-foreground leading-tight tracking-tight">
                      {displayName}
                    </h1>

                    {displayTagline && (
                      <p className="text-2xl font-light italic text-muted-foreground/90 leading-relaxed">
                        {displayTagline}
                      </p>
                    )}
                  </div>

                  <div className="flex items-end gap-3 pb-6 border-b border-border/40">
                    <PriceDisplay amount={product.price} size="lg" className="text-3xl font-bold" />
                    {product.compare_at_price && product.compare_at_price > product.price && (
                      <span className="text-muted-foreground line-through text-lg mb-1">
                        <PriceDisplay amount={product.compare_at_price} size="md" />
                      </span>
                    )}
                  </div>

                  {isAuthenticated && !isQualifiedMember && (
                    <Alert variant="default" className="bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400">
                      <GraduationCap className="h-4 w-4" />
                      <AlertDescription className="ml-2">
                        {t("products.purchaseRequirements.qualificationRequired")}
                        <Button asChild variant="link" className="p-0 h-auto ml-1 font-semibold text-amber-700 dark:text-amber-300">
                          <Link to="/qualification-test">{t("memberPortal.status.takeTest")}</Link>
                        </Button>
                      </AlertDescription>
                    </Alert>
                  )}

                  {isAuthenticated && isQualifiedMember && !hasInformedConsent && (
                    <Alert variant="default" className="bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400">
                      <FileSignature className="h-4 w-4" />
                      <AlertDescription className="ml-2">
                        {t("products.purchaseRequirements.consentRequired")}
                        <Button asChild variant="link" className="p-0 h-auto ml-1 font-semibold text-blue-700 dark:text-blue-300">
                          <Link to="/informed-consent">{t("memberPortal.status.signConsent")}</Link>
                        </Button>
                      </AlertDescription>
                    </Alert>
                  )}

                  {!isAuthenticated && (
                    <div className="p-4 bg-muted/40 rounded-lg border border-border/50 text-center">
                      <p className="text-muted-foreground mb-3">{t("shop.signInToPurchase")}</p>
                      <Button asChild variant="outline">
                        <Link to="/auth">{t("common.signIn")}</Link>
                      </Button>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-3">
                    <Button
                      size="lg"
                      className="sm:flex-1 text-lg h-14"
                      onClick={() => addToCart(product.id, 1)}
                      disabled={!canPurchase || product.in_stock === false}
                    >
                      <ShoppingBag className="mr-2 h-5 w-5" />
                      {t("shop.addToCart")}
                    </Button>
                  </div>

                  {displayDescription && (
                    <div className="prose prose-neutral dark:prose-invert max-w-none">
                      <h3 className="text-lg font-semibold mb-2 hidden">{t("shop.aboutProduct")}</h3>
                      <p className="text-muted-foreground leading-relaxed whitespace-pre-line text-lg">
                        {displayDescription}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Enhanced Marketing Content Sections */}
              <div className="space-y-16 max-w-4xl mx-auto">
                {/* Origin / Provenance */}
                {resolvedOrigin != null && typeof resolvedOrigin === "object" && (
                  <section className="">
                    <MarketingSection content={resolvedOrigin} />
                  </section>
                )}

                <hr className="border-border/40" />

                {/* Benefits */}
                {(typeof benefitsTitle === "string" || (resolvedBenefits != null && typeof resolvedBenefits === "object")) && (
                  <section>
                    <MarketingSection content={resolvedBenefits} title={benefitsTitle} />
                  </section>
                )}

                <hr className="border-border/40" />

                {/* Composition / Substances */}
                {(typeof compositionTitle === "string" || (resolvedSubstances != null && typeof resolvedSubstances === "object")) && (
                  <section>
                    <MarketingSection content={resolvedSubstances} title={compositionTitle} />
                  </section>
                )}

                <hr className="border-border/40" />

                {/* Usage */}
                {(typeof usageTitle === "string" || (resolvedUsage != null && typeof resolvedUsage === "object")) && (
                  <section>
                    <MarketingSection content={resolvedUsage} title={usageTitle} />
                  </section>
                )}

                <div className="bg-muted/30 p-4 rounded-lg flex gap-3 text-sm text-muted-foreground italic">
                  <Shield className="h-5 w-5 flex-shrink-0 opacity-50" />
                  <p>{t("products.disclaimer")}</p>
                </div>
              </div>

              {/* Distribution Information */}
              <div className="mt-16 border-t border-border pt-16">
                <h2 className="font-serif text-2xl font-bold mb-6 text-center">{t("distribution.title")}</h2>
                <ProductDistributionInfo
                  productId={product.id}
                  productName={displayName}
                />
              </div>

              {/* Product Transparency */}
              <div className="mt-16 border-t border-border pt-16">
                <ProductTransparencySection productSlug={product.slug} />
              </div>

              <div className="mt-16 border-t border-border pt-16">
                <ProductReviews productSlug={product.slug} />
              </div>
            </>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
