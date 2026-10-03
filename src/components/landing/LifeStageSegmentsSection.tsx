import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Baby, Activity, Heart, Sunrise } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useScrollReveal, getStaggerDelay } from "@/hooks/useScrollReveal";

interface Segment {
  key: string;
  icon: LucideIcon;
  audience: string;
  gradient: string;
  glowColor: string;
}

const segments: Segment[] = [
  { key: "kids", icon: Baby, audience: "kids", gradient: "from-amber-500/20 to-orange-500/10", glowColor: "amber" },
  { key: "athletes", icon: Activity, audience: "athletes", gradient: "from-emerald-500/20 to-teal-500/10", glowColor: "emerald" },
  { key: "midlife", icon: Heart, audience: "adults", gradient: "from-rose-500/20 to-pink-500/10", glowColor: "rose" },
  { key: "seniors", icon: Sunrise, audience: "seniors", gradient: "from-violet-500/20 to-purple-500/10", glowColor: "violet" },
];

export function LifeStageSegmentsSection() {
  const { t } = useTranslation();
  const { ref: headerRef, isVisible: headerVisible } = useScrollReveal();
  const { ref: gridRef, isVisible: gridVisible } = useScrollReveal();

  return (
    <section className="py-16 md:py-24 surface-container-low">
      <div className="container mx-auto px-4">
        {/* Header */}
        <div
          ref={headerRef}
          className={`text-center mb-12 reveal-fade-up ${headerVisible ? 'reveal-visible' : 'reveal-hidden'}`}
        >
          <h2 className="font-serif text-3xl sm:text-4xl font-semibold text-foreground mb-4">
            {t('landing.segments.title')}
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            {t('landing.segments.subtitle')}
          </p>
        </div>

        {/* Segments Grid */}
        <div ref={gridRef} className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          {segments.map((segment, index) => {
            const IconComponent = segment.icon;
            return (
              <Link
                key={segment.key}
                to={`/shop?audience=${segment.audience}`}
                className={`group relative p-6 md:p-8 bg-card rounded-2xl border border-border/40 card-hover-glow elevation-1 text-center reveal-fade-up ${gridVisible ? 'reveal-visible' : 'reveal-hidden'}`}
                style={getStaggerDelay(index)}
              >
                {/* Hover gradient */}
                <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${segment.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />

                <div className="relative">
                  {/* Icon */}
                  <div className="w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-primary/10 group-hover:bg-primary/20 flex items-center justify-center mx-auto mb-4 transition-colors">
                    <IconComponent className="h-7 w-7 md:h-8 md:w-8 text-primary icon-hover-lift" />
                  </div>

                  {/* Title */}
                  <h3 className="font-semibold text-lg md:text-xl text-foreground group-hover:text-primary transition-colors mb-2">
                    {t(`landing.segments.${segment.key}.title`)}
                  </h3>

                  {/* Description */}
                  <p className="text-sm text-muted-foreground">
                    {t(`landing.segments.${segment.key}.description`)}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
