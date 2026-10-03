import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ArrowRight, ShoppingCart, ChevronLeft, ChevronRight, Sparkles, Check, Baby, Dumbbell, Heart, Brain, Leaf, Star, Shield, FlaskConical, Microscope, Pill, Apple, Sun, Moon, Zap, Award, type LucideProps } from "lucide-react";
import { useHeroSlides, type HeroSlide } from "@/hooks/useHeroSlides";
import { useCart } from "@/hooks/useCart";
import { PriceDisplay } from "@/components/common/PriceDisplay";
import { cn } from "@/lib/utils";

/**
 * Preload and decode all hero slide images so they are warm in the browser cache
 * before the slide transitions. Uses HTMLImageElement.decode() to ensure the image
 * is fully decoded and ready for instant compositing (no flash/re-download).
 */
function usePreloadSlideImages(slides: HeroSlide[]) {
  const cacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  useEffect(() => {
    const cache = cacheRef.current;
    const urls = slides
      .map((s) => s.backgroundImageUrl)
      .filter((url): url is string => !!url && url.length > 0);

    for (const url of urls) {
      if (cache.has(url)) continue;
      const img = new Image();
      img.src = url;
      img.decode().catch((_decodeErr) => {
        /* ignore decode errors — image will still load normally */
      });
      cache.set(url, img);
    }

    // Cleanup images that are no longer in the slide set
    for (const [url] of cache) {
      if (!urls.includes(url)) {
        cache.delete(url);
      }
    }
  }, [slides]);
}

/**
 * Curated map of Lucide icons available for hero slides.
 * Uses named imports (tree-shakeable) instead of `import * as LucideIcons`
 * which would bundle ALL 1500+ icons (~877 kB).
 *
 * To add a new icon: import it above and add to this map.
 */
const HERO_ICON_MAP: Record<string, React.ComponentType<LucideProps>> = {
  Sparkles, Baby, Dumbbell, Heart, Brain,
  Leaf, Star, Shield, FlaskConical, Microscope,
  Pill, Apple, Sun, Moon, Zap, Award,
};

/** Render a Lucide icon by PascalCase name from the curated hero icon set. */
function HeroDynamicIcon({ name, className }: { name: string; className?: string }) {
  const IconComponent = HERO_ICON_MAP[name];
  if (!IconComponent) {
    return <Sparkles className={className} />;
  }
  return <IconComponent className={className} />;
}

export function HeroSlider() {
  const { t } = useTranslation();
  const { data: slides = [], isLoading } = useHeroSlides();
  const { addToCart } = useCart();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [addedToCart, setAddedToCart] = useState<string | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLElement>(null);

  // Preload + decode all slide images into browser cache on mount
  usePreloadSlideImages(slides);

  // Parallax mouse tracking — throttled via rAF to avoid forced reflow on every mousemove
  const rafRef = useRef<number>(0);
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current) return;
    // Capture event values synchronously (React pools events)
    const clientX = e.clientX;
    const clientY = e.clientY;
    if (rafRef.current) return; // Skip if a frame is already queued
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = (clientX - rect.left - rect.width / 2) / rect.width;
      const y = (clientY - rect.top - rect.height / 2) / rect.height;
      setMousePosition({ x, y });
    });
  }, []);

  // Clean up pending rAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const goToSlide = useCallback((index: number) => {
    if (slides.length === 0) return;
    setCurrentIndex(index);
  }, [slides.length]);

  const nextSlide = useCallback(() => {
    const next = (currentIndex + 1) % slides.length;
    goToSlide(next);
  }, [currentIndex, slides.length, goToSlide]);

  const prevSlide = useCallback(() => {
    const prev = (currentIndex - 1 + slides.length) % slides.length;
    goToSlide(prev);
  }, [currentIndex, slides.length, goToSlide]);

  useEffect(() => {
    if (slides.length === 0) return;
    if (currentIndex >= slides.length) {
      setCurrentIndex(0);
    }
  }, [currentIndex, slides.length]);

  // Auto-advance slides
  useEffect(() => {
    if (slides.length <= 1) return;
    const timer = setInterval(nextSlide, 7000);
    return () => clearInterval(timer);
  }, [slides.length, nextSlide]);

  const handleQuickAdd = async (slide: HeroSlide) => {
    if (slide.linkedProductId) {
      const success = await addToCart(slide.linkedProductId);
      if (success) {
        setAddedToCart(slide.id);
        setTimeout(() => setAddedToCart(null), 2000);
      }
    }
  };

  // Static fallback content for LCP optimization - renders immediately while data loads
  // This ensures the H1 (LCP element) is painted without waiting for async data
  const fallbackTitle = t('landing.hero.fallbackTitle');
  const fallbackSubtitle = t('landing.hero.fallbackSubtitle');

  // Use same DOM structure for loading and loaded states to prevent CLS
  const showSkeleton = isLoading || slides.length === 0;
  const safeIndex = !showSkeleton && currentIndex < slides.length ? currentIndex : 0;
  const currentSlide = !showSkeleton ? slides[safeIndex] : null;

  // Resolve display values — same structure for loading and loaded states (prevents CLS)
  const displayTitle = currentSlide?.title ?? fallbackTitle;
  const displaySubtitle = currentSlide?.subtitle ?? fallbackSubtitle;

  // Preload first hero slide image to reduce LCP resource-load delay.
  // The image URL is dynamic (from RPC), so we inject a <link rel="preload"> once known.
  const firstSlideImageUrl = useMemo(() => {
    if (slides.length > 0 && slides[0].backgroundImageUrl) return slides[0].backgroundImageUrl;
    return null;
  }, [slides]);

  useEffect(() => {
    if (!firstSlideImageUrl) return;
    // Avoid duplicate preloads
    const existing = document.querySelector(`link[rel="preload"][href="${CSS.escape(firstSlideImageUrl)}"]`);
    if (existing) return;
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = firstSlideImageUrl;
    link.setAttribute("fetchpriority", "high");
    document.head.appendChild(link);
    return () => {
      link.remove();
    };
  }, [firstSlideImageUrl]);

  return (
    <section
      ref={containerRef}
      className="relative min-h-[600px] md:min-h-[700px] lg:min-h-[750px] xl:min-h-[800px] flex items-center overflow-hidden"
      onMouseMove={handleMouseMove}
    >
      {/* Layered background with parallax */}
      <div className="absolute inset-0">
        {/* Base gradient layer */}
        <div
          className={cn(
            "absolute inset-0 transition-all duration-1000 ease-out",
            currentSlide?.backgroundGradient
              ? `bg-gradient-to-br ${currentSlide.backgroundGradient}`
              : "bg-gradient-to-br from-primary/10 via-background to-background"
          )}
        />

        {/* Background images — ALL slides rendered simultaneously, only active one visible.
            This avoids unmount/remount on slide change → no re-download, no decode flash.
            The browser keeps decoded bitmaps warm for instant compositing. */}
        {slides.map((slide, idx) => {
          const hasImage = slide.backgroundImageUrl && slide.backgroundImageUrl.length > 0;
          if (!hasImage) return null;
          const isActive = idx === safeIndex && !showSkeleton;
          return (
            <div
              key={slide.id}
              className="absolute inset-0 transition-opacity duration-1000 ease-out"
              style={{
                opacity: isActive ? 1 : 0,
                pointerEvents: isActive ? "auto" : "none",
                transform: isActive
                  ? `translate(${mousePosition.x * -20}px, ${mousePosition.y * -20}px) scale(1.1)`
                  : "scale(1.1)",
                transition: isActive
                  ? "opacity 1000ms ease-out, transform 200ms ease-out"
                  : "opacity 1000ms ease-out",
              }}
            >
              <img
                src={slide.backgroundImageUrl}
                alt=""
                className="w-full h-full object-cover opacity-30"
                loading={idx === 0 ? "eager" : "lazy"}
                fetchPriority={idx === 0 ? "high" : "low"}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-background/40" />
            </div>
          );
        })}

        {/* Animated floating elements - love brand style */}
        <div
          className="absolute w-[500px] h-[500px] rounded-full blur-[100px] opacity-30 transition-all duration-700"
          style={{
            background: "radial-gradient(circle, hsl(var(--primary) / 0.4), transparent 70%)",
            top: `${20 + mousePosition.y * 10}%`,
            right: `${10 + mousePosition.x * 10}%`,
            transform: `translate(${mousePosition.x * 30}px, ${mousePosition.y * 30}px)`,
          }}
        />
        <div
          className="absolute w-[300px] h-[300px] rounded-full blur-[80px] opacity-20 transition-all duration-700"
          style={{
            background: "radial-gradient(circle, hsl(var(--secondary) / 0.5), transparent 70%)",
            bottom: `${20 - mousePosition.y * 10}%`,
            left: `${15 - mousePosition.x * 10}%`,
            transform: `translate(${mousePosition.x * -20}px, ${mousePosition.y * -20}px)`,
          }}
        />

        {/* Sparkle particles */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {[...Array(6)].map((_, i) => (
            <Sparkles
              key={i}
              className={cn(
                "absolute text-primary/20 animate-pulse",
                i % 2 === 0 ? "h-4 w-4" : "h-3 w-3"
              )}
              style={{
                top: `${15 + i * 15}%`,
                left: `${10 + i * 15}%`,
                animationDelay: `${i * 0.5}s`,
                transform: `translate(${mousePosition.x * (10 + i * 5)}px, ${mousePosition.y * (10 + i * 5)}px)`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="container relative mx-auto px-4 py-16 md:py-24 lg:py-32">
        <div className="max-w-5xl mx-auto min-h-[400px] md:min-h-[450px] lg:min-h-[500px] relative">
          {/* Slide navigation — same position in both states for CLS stability */}
          {slides.length > 1 && (
            <div className="relative z-10 flex justify-center mb-4 md:absolute md:right-0 md:top-0 md:mb-0 md:justify-end">
              <div className="flex items-center gap-3 md:gap-4">
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full h-8 w-8 md:h-10 md:w-10 bg-background/60 backdrop-blur-sm border border-border/40 hover:bg-primary/10 hover:border-primary transition-all"
                  onClick={prevSlide}
                  aria-label={t('common.previous')}
                >
                  <ChevronLeft className="h-4 w-4 md:h-5 md:w-5" />
                </Button>

                <div className="flex gap-2">
                  {slides.map((slide, index) => (
                    <button
                      key={slide.id}
                      className={cn(
                        "h-2.5 rounded-full transition-all duration-300",
                        index === currentIndex
                          ? "w-8 bg-primary shadow-md shadow-primary/30"
                          : "w-2.5 bg-foreground/25 hover:bg-foreground/45"
                      )}
                      onClick={() => goToSlide(index)}
                      aria-label={`Go to slide ${index + 1}`}
                    />
                  ))}
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full h-8 w-8 md:h-10 md:w-10 bg-background/60 backdrop-blur-sm border border-border/40 hover:bg-primary/10 hover:border-primary transition-all"
                  onClick={nextSlide}
                  aria-label={t('common.next')}
                >
                  <ChevronRight className="h-4 w-4 md:h-5 md:w-5" />
                </Button>
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-5 lg:grid-cols-2 gap-8 md:gap-10 lg:gap-16 items-center">
            {/* Text content — key forces remount on slide change → triggers fade-in animation */}
            <div
              key={safeIndex}
              className="md:col-span-3 lg:col-span-1 text-center lg:text-left animate-slide-fade-in"
            >
              {/* Badge with glow — skeleton when loading */}
              <div className="min-h-[36px] md:min-h-[40px] mb-6 md:mb-8">
                {showSkeleton ? (
                  <div className="inline-flex h-8 w-32 bg-muted/30 rounded-full animate-pulse" />
                ) : currentSlide?.badge ? (
                  <div className="inline-flex items-center gap-1.5 md:gap-2 px-3 md:px-4 lg:px-5 py-2 md:py-2.5 rounded-full badge-shimmer backdrop-blur-sm border border-primary/20">
                    <Sparkles className="h-3 w-3 md:h-4 md:w-4 text-primary" />
                    <span className="text-xs md:text-sm font-semibold text-primary tracking-wide">
                      {currentSlide.badge}
                    </span>
                  </div>
                ) : null}
              </div>

              {/* Headline with gradient */}
              <h1 className="font-serif text-3xl sm:text-4xl md:text-4xl lg:text-5xl xl:text-6xl 2xl:text-7xl font-bold leading-[1.1] mb-4 md:mb-6">
                <span className="text-foreground">{displayTitle.split(' ').slice(0, -1).join(' ')}</span>{' '}
                <span className="text-gradient-primary">{displayTitle.split(' ').slice(-1)}</span>
              </h1>

              {/* Subtitle */}
              <p className="text-base sm:text-lg md:text-lg lg:text-xl text-muted-foreground max-w-xl mx-auto lg:mx-0 mb-6 md:mb-8 leading-relaxed">
                {displaySubtitle}
              </p>

              {/* Product info card - skeleton or real */}
              {showSkeleton ? (
                <div className="h-[140px] bg-muted/20 rounded-xl md:rounded-2xl mb-6 md:mb-8 max-w-md mx-auto lg:mx-0 animate-pulse" />
              ) : currentSlide?.linkedProductId && currentSlide.linkedProductName ? (
                <div className="bg-card/80 backdrop-blur-sm rounded-xl md:rounded-2xl p-4 md:p-5 lg:p-6 border border-border/50 mb-6 md:mb-8 max-w-md mx-auto lg:mx-0 elevation-3">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                        {t('landing.hero.featuredProduct')}
                      </p>
                      <h3 className="font-semibold text-foreground text-lg">
                        {currentSlide.linkedProductName}
                      </h3>
                    </div>
                    {currentSlide.linkedProductPrice > 0 && (
                      <div className="text-right">
                        <PriceDisplay
                          amount={currentSlide.linkedProductPrice}
                          size="lg"
                          className="text-primary"
                        />
                      </div>
                    )}
                  </div>

                  {/* Quick add button */}
                  <Button
                    size="lg"
                    className={cn(
                      "w-full rounded-xl h-14 text-base font-semibold transition-all duration-300",
                      addedToCart === currentSlide.id
                        ? "bg-emerald-500 hover:bg-emerald-600"
                        : "shadow-lg hover:shadow-xl hover:scale-[1.02]"
                    )}
                    onClick={() => handleQuickAdd(currentSlide)}
                    disabled={addedToCart === currentSlide.id}
                  >
                    {addedToCart === currentSlide.id ? (
                      <>
                        <Check className="mr-2 h-5 w-5" />
                        {t('landing.hero.addedToCart')}
                      </>
                    ) : (
                      <>
                        <ShoppingCart className="mr-2 h-5 w-5" />
                        {t('landing.hero.addToCart')}
                      </>
                    )}
                  </Button>
                </div>
              ) : null}

              {/* Secondary CTA — skeleton or real */}
              <div className="flex flex-wrap gap-3 md:gap-4 justify-center lg:justify-start">
                {showSkeleton ? (
                  <div className="h-12 md:h-14 w-32 md:w-40 bg-muted/50 rounded-full animate-pulse" />
                ) : (
                  <Button
                    size="lg"
                    variant="outline"
                    asChild
                    className="rounded-full px-6 md:px-8 h-12 md:h-14 text-sm md:text-base border-2 hover:bg-primary/10 hover:border-primary transition-all"
                  >
                    <Link to={currentSlide!.ctaUrl}>
                      {currentSlide!.ctaText}
                      <ArrowRight className="ml-2 h-5 w-5" />
                    </Link>
                  </Button>
                )}
              </div>
            </div>

            {/* Visual/Product showcase area */}
            <div
              className="relative md:col-span-2 lg:col-span-1 hidden md:flex items-center justify-center"
              style={{
                transform: `translate(${mousePosition.x * -10}px, ${mousePosition.y * -10}px)`,
              }}
            >
              {/* Decorative circles - responsive sizes */}
              <div className="absolute w-48 md:w-56 lg:w-80 h-48 md:h-56 lg:h-80 rounded-full border border-primary/20 animate-float" />
              <div className="absolute w-56 md:w-64 lg:w-96 h-56 md:h-64 lg:h-96 rounded-full border border-primary/10 animate-float-slow"
                style={{ animationDelay: "1s" }}
              />
              <div className="absolute w-64 md:w-80 lg:w-[450px] h-64 md:h-80 lg:h-[450px] rounded-full border border-primary/5" />

              {/* Center highlight - uses admin-configured icon and text */}
              <div className="relative w-40 md:w-48 lg:w-64 h-40 md:h-48 lg:h-64 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 backdrop-blur-sm flex items-center justify-center">
                <div key={safeIndex} className="text-center p-4 md:p-5 lg:p-6 animate-slide-fade-in">
                  {showSkeleton ? (
                    <Sparkles className="h-8 md:h-10 lg:h-12 w-8 md:w-10 lg:w-12 text-primary/40 mx-auto mb-2 md:mb-3 lg:mb-4 animate-pulse" />
                  ) : (
                    <HeroDynamicIcon name={currentSlide!.circleIcon || "Sparkles"} className="h-8 md:h-10 lg:h-12 w-8 md:w-10 lg:w-12 text-primary mx-auto mb-2 md:mb-3 lg:mb-4" />
                  )}
                  <p className="text-xs md:text-xs lg:text-sm text-muted-foreground uppercase tracking-widest leading-tight">
                    {showSkeleton ? '\u00A0' : (
                      currentSlide!.circleText || (
                        currentSlide!.targetAudience === 'all'
                          ? t('landing.hero.forEveryone')
                          : t(`landing.segments.${currentSlide!.targetAudience}.title`)
                      )
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Bottom gradient fade - reduced height */}
      <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-background to-transparent pointer-events-none" />
    </section>
  );
}
