import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ArrowRight, Building, FlaskConical, XCircle, Sparkles, Loader2, Calendar } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useArchiveFilterOptions, useArchiveDocuments } from "@/hooks/useArchiveDocuments";
import { useMemo } from "react";

interface DecadeData {
  decade: string;
  documentCount: number;
  icon: LucideIcon;
  color: string;
}

const decadeConfig: Record<string, { icon: LucideIcon; color: string }> = {
  "1930s": { icon: Building, color: "from-amber-500/20 to-orange-500/10" },
  "1940s": { icon: FlaskConical, color: "from-emerald-500/20 to-teal-500/10" },
  "1950s": { icon: FlaskConical, color: "from-blue-500/20 to-indigo-500/10" },
  "1960s": { icon: XCircle, color: "from-purple-500/20 to-violet-500/10" },
  "1970s": { icon: Sparkles, color: "from-rose-500/20 to-pink-500/10" },
  "1980s": { icon: Sparkles, color: "from-cyan-500/20 to-sky-500/10" },
};

export function TimelinePreviewSection() {
  const { t } = useTranslation();
  const { filterOptions, loading: filtersLoading } = useArchiveFilterOptions();
  const { documents, loading: docsLoading } = useArchiveDocuments({});

  // Calculate document counts per decade
  const decadeData = useMemo<DecadeData[]>(() => {
    const counts: Record<string, number> = {};
    documents.forEach(doc => {
      if (doc.decade) {
        counts[doc.decade] = (counts[doc.decade] || 0) + 1;
      }
    });
    
    return filterOptions.decades
      .map(decade => {
        const config = decadeConfig[decade] || { icon: FlaskConical, color: "from-primary/20 to-primary/5" };
        return {
          decade,
          documentCount: counts[decade] || 0,
          icon: config.icon,
          color: config.color,
        };
      })
      .filter(d => d.documentCount > 0)
      .slice(0, 6);
  }, [filterOptions.decades, documents]);

  // Only show loading state on initial load, not on refetch
  const isInitialLoading = (filtersLoading && filterOptions.decades.length === 0) || 
                           (docsLoading && documents.length === 0);

  // Don't render section while initially loading (prevents flash of empty content)
  if (isInitialLoading) {
    return (
      <section className="py-16 md:py-24 bg-gradient-to-b from-muted/50 to-background">
        <div className="container mx-auto px-4 flex justify-center">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">{t('common.loading')}</span>
          </div>
        </div>
      </section>
    );
  }

  if (decadeData.length === 0) {
    return null;
  }

  return (
    <section className="py-16 md:py-24 bg-gradient-to-b from-muted/50 to-background overflow-hidden">
      <div className="container mx-auto px-4">
        {/* Modern Header with gradient accent */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10 md:mb-14">
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium uppercase tracking-wider mb-4">
              <Calendar className="h-3.5 w-3.5" />
              {t('timeline.sectionLabel')}
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-semibold text-foreground leading-tight">
              {t('timeline.title')}
            </h2>
            <p className="mt-3 text-muted-foreground text-base sm:text-lg max-w-md">
              {t('timeline.subtitle')}
            </p>
          </div>
          <Button 
            variant="outline" 
            asChild 
            className="hidden sm:inline-flex rounded-full px-6 border-border/60 hover:bg-primary/5 hover:border-primary/30 transition-all group self-end"
          >
            <Link to="/archive">
              {t('timeline.browseFullTimeline')}
              <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </Button>
        </div>

        {/* Responsive Grid - 2 cols mobile, 3 cols tablet, up to 6 cols desktop */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
          {decadeData.map((item, index) => {
            const IconComponent = item.icon;
            return (
              <Link
                key={item.decade}
                to={`/archive?decade=${item.decade}`}
                className="group relative p-5 md:p-6 bg-card rounded-2xl border border-border/40 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                {/* Gradient background on hover */}
                <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${item.color} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
                
                <div className="relative">
                  {/* Icon */}
                  <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-primary/10 group-hover:bg-primary/20 flex items-center justify-center mb-4 transition-colors">
                    <IconComponent className="h-5 w-5 md:h-6 md:w-6 text-primary" />
                  </div>
                  
                  {/* Decade */}
                  <span className="text-xl md:text-2xl font-bold text-foreground group-hover:text-primary transition-colors">
                    {item.decade}
                  </span>
                  
                  {/* Document count */}
                  <p className="text-xs md:text-sm text-muted-foreground mt-2 flex items-center gap-1">
                    <span className="font-medium text-foreground/80">{item.documentCount}</span>
                    {t('timeline.documents')}
                  </p>
                  
                  {/* Hover arrow indicator */}
                  <div className="absolute top-4 right-0 opacity-0 group-hover:opacity-100 group-hover:translate-x-0 -translate-x-2 transition-all duration-300">
                    <ArrowRight className="h-4 w-4 text-primary" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {/* Mobile CTA */}
        <div className="mt-8 sm:hidden">
          <Button variant="outline" asChild className="w-full rounded-full border-border/60">
            <Link to="/archive">
              {t('timeline.browseFullTimeline')}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
