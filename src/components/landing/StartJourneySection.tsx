import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ArrowRight, ShoppingBag } from "lucide-react";
import { useScrollReveal } from "@/hooks/useScrollReveal";

export function StartJourneySection() {
  const { t } = useTranslation();
  const { ref, isVisible } = useScrollReveal();

  return (
    <section className="py-20 md:py-28 cta-premium-bg">
      {/* Animated gradient mesh orbs */}
      <div className="cta-mesh-orb cta-mesh-orb--lg"
        style={{ background: 'hsl(var(--md-color-primary) / 0.2)' }}
      />
      <div className="cta-mesh-orb cta-mesh-orb--md"
        style={{ background: 'hsl(var(--md-color-secondary) / 0.15)', animationDelay: '2s' }}
      />
      <div className="cta-mesh-orb cta-mesh-orb--sm"
        style={{ background: 'hsl(var(--md-color-tertiary) / 0.1)', animationDelay: '4s' }}
      />

      <div className="container relative mx-auto px-4">
        <div
          ref={ref}
          className={`max-w-3xl mx-auto text-center reveal-fade-scale ${isVisible ? 'reveal-visible' : 'reveal-hidden'}`}
        >
          <h2 className="font-serif text-3xl sm:text-4xl md:text-5xl font-semibold text-foreground mb-6">
            {t('landing.cta.title')}
          </h2>

          <p className="text-muted-foreground text-lg mb-10 max-w-xl mx-auto">
            {t('landing.cta.subtitle')}
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" asChild className="rounded-full px-10 text-foreground btn-pulse-glow">
              <Link to="/shop">
                <ShoppingBag className="mr-2 h-5 w-5" />
                {t('landing.cta.button')}
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild className="rounded-full px-10 hover:bg-primary/10 hover:border-primary transition-all">
              <Link to="/story">
                {t('landing.cta.learnMore')}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
