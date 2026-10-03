import { useTranslation } from "react-i18next";
import { Shield, Users, FlaskConical, Lock } from "lucide-react";
import { usePublicStats } from "@/hooks/usePublicStats";
import { useScrollReveal, getStaggerDelay } from "@/hooks/useScrollReveal";
import { useAnimatedCounter } from "@/hooks/useAnimatedCounter";

function AnimatedStat({ value }: { value: number }) {
  const { ref, value: animatedValue } = useAnimatedCounter({
    target: value,
    duration: 1800,
  });

  return (
    <p ref={ref as React.RefObject<HTMLParagraphElement>} className="text-2xl md:text-3xl font-bold text-foreground mb-1">
      {animatedValue.toLocaleString()}+
    </p>
  );
}

export function TrustSection() {
  const { t } = useTranslation();
  const { data: stats } = usePublicStats();
  const { ref: sectionRef, isVisible } = useScrollReveal();

  const trustPoints = [
    {
      icon: Shield,
      labelKey: 'landing.trust.quality.title',
      descKey: 'landing.trust.quality.description'
    },
    {
      icon: Users,
      labelKey: 'landing.trust.community.title',
      descKey: 'landing.trust.community.description',
      value: stats?.member_count
    },
    {
      icon: FlaskConical,
      labelKey: 'landing.trust.research.title',
      descKey: 'landing.trust.research.description',
      value: stats?.study_count
    },
    {
      icon: Lock,
      labelKey: 'landing.trust.security.title',
      descKey: 'landing.trust.security.description'
    },
  ];

  return (
    <section className="py-16 md:py-24 surface-container-low">
      <div className="container mx-auto px-4">
        <div
          ref={sectionRef}
          className={`text-center mb-12 reveal-fade-up ${isVisible ? 'reveal-visible' : 'reveal-hidden'}`}
        >
          <h2 className="font-serif text-3xl sm:text-4xl font-semibold text-foreground mb-4">
            {t('landing.trust.title')}
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            {t('landing.trust.subtitle')}
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          {trustPoints.map((point, index) => {
            const IconComponent = point.icon;
            return (
              <div
                key={point.labelKey}
                className={`group p-6 bg-card rounded-2xl border border-border/40 text-center card-hover-glow elevation-1 reveal-fade-up ${isVisible ? 'reveal-visible' : 'reveal-hidden'}`}
                style={getStaggerDelay(index + 1)}
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <IconComponent className="h-6 w-6 text-primary icon-hover-lift" />
                </div>

                {point.value !== undefined ? (
                  <AnimatedStat value={point.value} />
                ) : null}

                <h3 className="font-semibold text-foreground mb-2">
                  {t(point.labelKey)}
                </h3>

                <p className="text-sm text-muted-foreground">
                  {t(point.descKey)}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
