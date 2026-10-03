import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { FlaskConical, Archive, ArrowRight, FileText } from "lucide-react";
import { useScrollReveal, getStaggerDelay } from "@/hooks/useScrollReveal";

export function ResearchBridgeSection() {
  const { t } = useTranslation();
  const { ref: headerRef, isVisible: headerVisible } = useScrollReveal();
  const { ref: cardsRef, isVisible: cardsVisible } = useScrollReveal();

  return (
    <section className="py-16 md:py-24">
      <div className="container mx-auto px-4">
        <div className="max-w-4xl mx-auto text-center">
          {/* Header */}
          <div
            ref={headerRef}
            className={`reveal-fade-up ${headerVisible ? 'reveal-visible' : 'reveal-hidden'}`}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full badge-shimmer text-foreground text-xs font-medium uppercase tracking-wider mb-6 border border-primary/20">
              <FlaskConical className="h-3.5 w-3.5 text-primary" />
              {t('landing.research.label')}
            </div>

            <h2 className="font-serif text-3xl sm:text-4xl font-semibold text-foreground mb-4">
              {t('landing.research.title')}
            </h2>

            <p className="text-muted-foreground text-lg max-w-2xl mx-auto mb-10">
              {t('landing.research.subtitle')}
            </p>
          </div>

          {/* Cards */}
          <div
            ref={cardsRef}
            className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 mb-10"
          >
            {/* Archive Card */}
            <Link
              to="/archive"
              className={`group p-6 md:p-8 bg-card rounded-2xl border border-border/40 card-hover-glow elevation-1 text-left reveal-slide-left ${cardsVisible ? 'reveal-visible' : 'reveal-hidden'}`}
              style={getStaggerDelay(0)}
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 group-hover:bg-primary/20 flex items-center justify-center mb-4 transition-colors">
                <Archive className="h-6 w-6 text-primary icon-hover-lift" />
              </div>
              <h3 className="font-semibold text-xl text-foreground group-hover:text-primary transition-colors mb-2">
                {t('landing.research.archive.title')}
              </h3>
              <p className="text-muted-foreground">
                {t('landing.research.archive.description')}
              </p>
            </Link>

            {/* Studies Card */}
            <Link
              to="/studies"
              className={`group p-6 md:p-8 bg-card rounded-2xl border border-border/40 card-hover-glow elevation-1 text-left reveal-slide-right ${cardsVisible ? 'reveal-visible' : 'reveal-hidden'}`}
              style={getStaggerDelay(1)}
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 group-hover:bg-primary/20 flex items-center justify-center mb-4 transition-colors">
                <FileText className="h-6 w-6 text-primary icon-hover-lift" />
              </div>
              <h3 className="font-semibold text-xl text-foreground group-hover:text-primary transition-colors mb-2">
                {t('landing.research.studies.title')}
              </h3>
              <p className="text-muted-foreground">
                {t('landing.research.studies.description')}
              </p>
            </Link>
          </div>

          {/* CTA */}
          <Button variant="outline" size="lg" asChild className="rounded-full px-8 hover:bg-primary/10 hover:border-primary transition-all">
            <Link to="/studies">
              {t('landing.research.cta')}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
