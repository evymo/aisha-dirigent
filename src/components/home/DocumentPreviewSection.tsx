import { Link } from "react-router-dom";
import { getTranslationLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, FileText, Mail, BookOpen, FlaskConical, Camera, Beaker, FileCheck, MessageSquare, ScrollText, Award, Loader2, ExternalLink } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useArchiveDocuments, getLocalizedField, getLocalizedSummary } from "@/hooks/useArchiveDocuments";

const typeIcons: Record<string, LucideIcon> = {
  operational_report: FlaskConical,
  operational_study: FlaskConical,
  research_paper: BookOpen,
  patent: Award,
  letter: Mail,
  photograph: Camera,
  formula: Beaker,
  correspondence: MessageSquare,
  certificate: FileCheck,
  testimonial: ScrollText,
  protocol: FileText,
  preparation_record: FileText,
};

const typeColors: Record<string, string> = {
  operational_report: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  operational_study: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  research_paper: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  patent: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  letter: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  photograph: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  formula: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  correspondence: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
  certificate: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  testimonial: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  protocol: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
  preparation_record: "bg-lime-500/10 text-lime-600 dark:text-lime-400",
};

export function DocumentPreviewSection() {
  const { t, i18n } = useTranslation();
  const { documents, loading } = useArchiveDocuments({});
  const currentLocale = getTranslationLocale(i18n.language);

  // Get featured documents, or first 6 if none are featured
  const featuredDocuments = documents.filter(d => d.is_featured).slice(0, 6);
  const displayDocuments = featuredDocuments.length > 0 ? featuredDocuments : documents.slice(0, 6);

  const provenanceLabels: Record<string, { labelKey: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    original_scan: { labelKey: "admin.archive.provenanceBadges.original_scan", variant: "default" },
    translated_excerpt: { labelKey: "admin.archive.provenanceBadges.translated_excerpt", variant: "secondary" },
    editorial_note: { labelKey: "admin.archive.provenanceBadges.editorial_note", variant: "outline" },
    unverified_claim: { labelKey: "admin.archive.provenanceBadges.unverified_claim", variant: "destructive" },
  };

  // Only show loading state on initial load, not on refetch (prevents flickering)
  const isInitialLoading = loading && displayDocuments.length === 0;

  if (isInitialLoading) {
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

  if (displayDocuments.length === 0) {
    return null;
  }

  return (
    <section className="py-16 md:py-24">
      <div className="container mx-auto px-4">
        {/* Modern Header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10 md:mb-14">
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary/50 text-secondary-foreground text-xs font-medium uppercase tracking-wider mb-4">
              <FileText className="h-3.5 w-3.5" />
              {t('documents.sectionLabel')}
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-semibold text-foreground leading-tight">
              {t('documents.title')}
            </h2>
            <p className="mt-3 text-muted-foreground text-base sm:text-lg max-w-md">
              {t('documents.subtitle')}
            </p>
          </div>
          <Button 
            variant="outline" 
            asChild 
            className="hidden sm:inline-flex rounded-full px-6 border-border/60 hover:bg-primary/5 hover:border-primary/30 transition-all group self-end"
          >
            <Link to="/archive">
              {t('documents.browseAll')}
              <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </Button>
        </div>

        {/* Responsive Grid - 1 col mobile, 2 cols tablet, 3 cols desktop */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
          {displayDocuments.map((doc, index) => {
            const IconComponent = typeIcons[doc.document_type] || FileText;
            const iconColorClass = typeColors[doc.document_type] || "bg-muted text-muted-foreground";
            const provenance = provenanceLabels[doc.provenance_badge] || provenanceLabels.original_scan;
            const title = getLocalizedField(doc, 'title', currentLocale) || doc.title;
            const description = getLocalizedField(doc, 'description', currentLocale) || getLocalizedSummary(doc, currentLocale);
            
            return (
              <Link
                key={doc.id}
                to={`/archive/${doc.slug}`}
                className="group relative flex flex-col p-5 md:p-6 bg-card rounded-2xl border border-border/40 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                {/* Top row: Icon + Meta */}
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className={`flex-shrink-0 w-11 h-11 md:w-12 md:h-12 rounded-xl ${iconColorClass} flex items-center justify-center transition-transform group-hover:scale-105`}>
                    <IconComponent className="h-5 w-5 md:h-6 md:w-6" />
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <Badge variant={provenance.variant} className="text-[10px] md:text-xs rounded-full">
                      {t(provenance.labelKey)}
                    </Badge>
                    {doc.year && (
                      <span className="text-xs text-muted-foreground font-medium">{doc.year}</span>
                    )}
                  </div>
                </div>
                
                {/* Title */}
                <h3 className="font-medium text-base md:text-lg text-foreground group-hover:text-primary transition-colors mb-2 line-clamp-2 leading-snug">
                  {title}
                </h3>
                
                {/* Description */}
                {description && (
                  <p className="text-sm text-muted-foreground line-clamp-2 flex-grow">
                    {description}
                  </p>
                )}
                
                {/* Bottom: Document type + hover indicator */}
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-border/40">
                  <span className="text-xs text-muted-foreground capitalize">
                    {t(`archive.documentTypes.${doc.document_type}`)}
                  </span>
                  <div className="flex items-center gap-1 text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                    <span>{t('common.viewDetails')}</span>
                    <ExternalLink className="h-3 w-3" />
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
              {t('documents.browseAll')}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
