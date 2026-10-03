import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ArrowRight, Users, FlaskConical, ShieldCheck, Heart } from "lucide-react";
import { usePublicStats } from "@/hooks/usePublicStats";

export function HeroSection() {
  const { t } = useTranslation();
  const { data: stats, isLoading } = usePublicStats();

  const formatNumber = (value: number) => new Intl.NumberFormat().format(value);

  const statsItems = [
    { 
      icon: Users, 
      value: stats?.member_count, 
      label: t('hero.stats.members'),
      suffix: "+"
    },
    { 
      icon: FlaskConical, 
      value: stats?.study_count, 
      label: t('hero.stats.studies'),
      suffix: ""
    },
    { 
      icon: Heart, 
      value: stats?.partner_count, 
      label: t('hero.stats.partners'),
      suffix: ""
    },
    { 
      icon: ShieldCheck, 
      value: "100%", 
      label: t('hero.stats.secure'),
      suffix: ""
    },
  ];

  return (
    <section className="relative bg-background">
      {/* Hero Content */}
      <div className="container mx-auto px-4 py-20 md:py-28 lg:py-32">
        <div className="max-w-4xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-muted rounded-full mb-8 animate-fade-in">
            <Heart className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-muted-foreground">{t('hero.badge')}</span>
          </div>

          {/* Headline */}
          <h1 className="font-sans text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-foreground leading-tight mb-6 animate-fade-in" style={{ animationDelay: '0.1s' }}>
            {t('hero.headlinePart1')}{" "}
            <span className="text-gradient-primary">{t('hero.headlinePart2')}</span>
          </h1>

          {/* Subtitle */}
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed animate-fade-in" style={{ animationDelay: '0.2s' }}>
            {t('hero.subheadline')}
          </p>

          {/* CTAs */}
          <div className="flex flex-wrap justify-center gap-4 mb-16 animate-fade-in" style={{ animationDelay: '0.3s' }}>
            <Button size="lg" asChild className="rounded-full px-8 h-14 text-base font-semibold shadow-lg hover:shadow-xl transition-all">
              <Link to="/studies">
                {t('hero.cta.primary')}
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button variant="outline" size="lg" asChild className="rounded-full px-8 h-14 text-base font-semibold border-2 hover:bg-muted transition-all">
              <Link to="/faq">
                {t('hero.cta.secondary')}
              </Link>
            </Button>
            <Button variant="ghost" size="lg" asChild className="rounded-full px-6 h-14 text-base font-medium hover:bg-muted transition-all">
              <Link to="/protocol">
                {t('hero.cta.protocol')}
              </Link>
            </Button>
          </div>
        </div>

        {/* Stats Grid - Real data from RPC with smooth loading */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 max-w-4xl mx-auto animate-fade-in" style={{ animationDelay: '0.4s' }}>
          {statsItems.map((stat, index) => (
            <div key={index} className="stats-card group hover:border-primary/30 transition-all duration-300">
              <div className="flex justify-center mb-4">
                <div className="icon-box-primary group-hover:bg-primary/20 transition-colors">
                  <stat.icon className="w-6 h-6" />
                </div>
              </div>
              <div className="text-3xl md:text-4xl font-bold text-foreground mb-1 tabular-nums">
                {typeof stat.value === "number" ? (
                  <span className={`transition-opacity duration-300 ${isLoading ? "opacity-60" : "opacity-100"}`}>
                    {formatNumber(stat.value)}{stat.suffix}
                  </span>
                ) : typeof stat.value === "string" ? (
                  <span>{stat.value}{stat.suffix}</span>
                ) : (
                  <span className={`transition-opacity duration-300 ${isLoading ? "opacity-60" : "opacity-80"}`}>
                    —
                  </span>
                )}
              </div>
              <div className="text-sm text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Subtle gradient at bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-muted/50 to-transparent pointer-events-none" />
    </section>
  );
}
