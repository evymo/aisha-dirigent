import { Link, useSearchParams } from "react-router-dom";
import { getTranslationLocale } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  FilterDropdown,
  FilterDropdownMulti,
  type FilterDropdownOption,
} from "@/components/ui/filter-dropdown";
import { 
  Search, 
  Filter, 
  FileText, 
  Mail, 
  FlaskConical,
  Calendar,
  BookOpen,
  Award,
  ScrollText,
  Camera,
  Beaker,
  FileCheck,
  MessageSquare,
  X,
  MapPin,
  User,
  Eye,
  Download
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useArchiveDocuments, useArchiveFilterOptions, getLocalizedField, getLocalizedSummary } from "@/hooks/useArchiveDocuments";
import { useDebounce } from "@/hooks/useDebounce";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "react-i18next";

const typeIcons: Record<string, React.ElementType> = {
  operational_report: FlaskConical,
  research_paper: BookOpen,
  patent: Award,
  letter: Mail,
  photograph: Camera,
  formula: Beaker,
  correspondence: MessageSquare,
  certificate: FileCheck,
  testimonial: ScrollText,
  protocol: FileText,
};

export default function Archive() {
  const { t, i18n } = useTranslation();

  const getDocumentTypeLabel = (type: string) =>
    t(`admin.archive.documentTypes.${type}`);
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const [selectedDecade, setSelectedDecade] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [selectedPreparation, setSelectedPreparation] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  /** Ref to the document grid — we scroll here after filter changes. */
  const documentGridRef = useRef<HTMLElement>(null);
  /** True once the initial URL→state sync is done and user starts interacting. */
  const userInteractedRef = useRef(false);

  const hasProcessedUrlParamsRef = useRef(false);
  const lastProcessedUrlSignatureRef = useRef<string | null>(null);

  const { filterOptions, loading: filtersLoading } = useArchiveFilterOptions();
  const { documents, loading } = useArchiveDocuments({
    decade: selectedDecade,
    documentType: selectedType,
    preparation: selectedPreparation,
    keywords: selectedTags.length > 0 ? selectedTags : undefined,
    searchQuery: debouncedSearchQuery || undefined,
  });

  useEffect(() => {
    if (filtersLoading) return;

    const urlSignature = searchParams.toString();
    if (lastProcessedUrlSignatureRef.current === urlSignature) return;

    const decadeFromUrl = searchParams.get("decade");
    const typeFromUrl = searchParams.get("type");
    const preparationFromUrl = searchParams.get("prep");
    const tagsFromUrlRaw = searchParams.getAll("tag");
    const queryFromUrl = searchParams.get("q");

    const nextSearchQuery = queryFromUrl ?? "";
    const nextDecade = decadeFromUrl && filterOptions.decades.includes(decadeFromUrl) ? decadeFromUrl : null;
    const nextType = typeFromUrl && filterOptions.documentTypes.includes(typeFromUrl) ? typeFromUrl : null;
    const nextPreparation =
      preparationFromUrl && filterOptions.preparations.includes(preparationFromUrl)
        ? preparationFromUrl
        : null;
    const nextTags = Array.from(
      new Set(
        tagsFromUrlRaw
          .flatMap((v) => v.split(","))
          .map((v) => v.trim())
          .filter((v): v is string => v.length > 0)
          .filter((v) => filterOptions.keywords.includes(v))
      )
    ).sort();

    const sameStringArray = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

    setSearchQuery((prev) => (prev === nextSearchQuery ? prev : nextSearchQuery));
    setSelectedDecade((prev) => (prev === nextDecade ? prev : nextDecade));
    setSelectedType((prev) => (prev === nextType ? prev : nextType));
    setSelectedPreparation((prev) => (prev === nextPreparation ? prev : nextPreparation));
    setSelectedTags((prev) => (sameStringArray(prev, nextTags) ? prev : nextTags));

    lastProcessedUrlSignatureRef.current = urlSignature;
    hasProcessedUrlParamsRef.current = true;
  }, [
    filterOptions.decades,
    filterOptions.documentTypes,
    filterOptions.preparations,
    filterOptions.keywords,
    filtersLoading,
    searchParams,
  ]);

  useEffect(() => {
    if (!hasProcessedUrlParamsRef.current) return;

    const nextParams = new URLSearchParams(searchParams);

    const setOrDelete = (key: string, value: string | null) => {
      if (value && value.trim().length > 0) nextParams.set(key, value);
      else nextParams.delete(key);
    };

    setOrDelete("decade", selectedDecade);
    setOrDelete("type", selectedType);
    setOrDelete("prep", selectedPreparation);
    setOrDelete("q", debouncedSearchQuery || null);

    nextParams.delete("tag");
    const normalizedTags = Array.from(new Set(selectedTags.map((t) => t.trim()).filter((t) => t.length > 0))).sort();
    for (const tag of normalizedTags) {
      nextParams.append("tag", tag);
    }

    // Neprováděj update, pokud by URL zůstala stejná.
    const nextSignature = nextParams.toString();
    if (nextSignature === searchParams.toString()) return;

    // Předejdi smyčce: až se URL aktualizuje, URL->state efekt už nic nepřepíše.
    lastProcessedUrlSignatureRef.current = nextSignature;

    setSearchParams(nextParams, { replace: true, preventScrollReset: true });

    // Mark that future changes are user-initiated
    userInteractedRef.current = true;
  }, [searchParams, debouncedSearchQuery, selectedDecade, selectedPreparation, selectedTags, selectedType, setSearchParams]);

  // Fingerprint of current filter state — scroll when this changes (not just doc count)
  const filterFingerprint = useMemo(
    () => [selectedDecade, selectedType, selectedPreparation, ...selectedTags, debouncedSearchQuery].join("|"),
    [selectedDecade, selectedType, selectedPreparation, selectedTags, debouncedSearchQuery],
  );

  // Scroll to document grid whenever filter results change (after user interaction)
  const prevFingerprintRef = useRef<string | null>(null);
  useEffect(() => {
    if (!userInteractedRef.current) {
      // First render / URL init — just record, don't scroll
      prevFingerprintRef.current = filterFingerprint;
      return;
    }
    if (loading) return;
    // Only scroll if filters actually changed
    if (prevFingerprintRef.current === filterFingerprint) return;
    prevFingerprintRef.current = filterFingerprint;

    requestAnimationFrame(() => {
      const el = documentGridRef.current;
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }, [filterFingerprint, loading]);

  const currentLocale = getTranslationLocale(i18n.language);

  const badgeLabels: Record<string, string> = {
    original_scan: t('admin.archive.provenanceBadges.original_scan'),
    translated_excerpt: t('admin.archive.provenanceBadges.translated_excerpt'),
    editorial_note: t('admin.archive.provenanceBadges.editorial_note'),
    unverified_claim: t('admin.archive.provenanceBadges.unverified_claim'),
  };

  const badgeVariants: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
    original_scan: "default",
    translated_excerpt: "secondary",
    editorial_note: "outline",
    unverified_claim: "destructive",
  };

  const hasActiveFilters = selectedDecade || selectedType || selectedPreparation || selectedTags.length > 0 || searchQuery;

  const activeFilterCount =
    [selectedDecade, selectedType, selectedPreparation].filter(Boolean).length +
    selectedTags.length;

  const clearAllFilters = () => {
    setSelectedDecade(null);
    setSelectedType(null);
    setSelectedPreparation(null);
    setSelectedTags([]);
    setSearchQuery("");
  };

  // Calculate year range from documents
  const yearRange = documents.length > 0 
    ? `${Math.min(...documents.filter(d => d.year).map(d => d.year!))}–${Math.max(...documents.filter(d => d.year).map(d => d.year!))}`
    : "1930s – 1980s";

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      {/* Hero */}
      <section className="pt-32 pb-16 bg-card border-b border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <span className="text-sm font-medium uppercase tracking-wider text-accent mb-4 block">
              {t('archive.sectionLabel')}
            </span>
            <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl font-bold text-foreground mb-6">
              {t('archive.title')}
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed mb-8">
              {t('archive.subtitle')}
            </p>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                {documents.length} {t('timeline.documents')}
              </span>
              <span className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {yearRange}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Search & Filters - sticky over header */}
      <section className="py-3 border-b border-border sticky top-0 z-50 shadow-sm bg-background/95 backdrop-blur-sm">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 space-y-3">
          {/* Search row + mobile filter toggle */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 lg:max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('archive.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-8"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={t('common.clearAll')}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Filter toggle - mobile only */}
            <Button
              variant="outline"
              size="icon"
              className="lg:hidden shrink-0 relative"
              onClick={() => setFiltersOpen((prev) => !prev)}
              aria-label={t('archive.filter')}
              aria-expanded={filtersOpen}
            >
              <Filter className="h-4 w-4" />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 h-4 min-w-4 rounded-full bg-accent text-[10px] font-bold text-accent-foreground flex items-center justify-center px-0.5">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </div>

          {/* Filters: collapsible grid on mobile, inline flex on desktop */}
          <div
            className={cn(
              "items-center gap-2 lg:gap-3",
              "grid grid-cols-2 lg:flex lg:flex-wrap",
              filtersOpen ? "grid" : "hidden lg:flex"
            )}
          >
            {/* Filter label - desktop only */}
            <div className="hidden lg:flex items-center gap-2 text-muted-foreground">
              <Filter className="h-4 w-4" />
              <span className="text-sm">{t('archive.filter')}</span>
            </div>

            {/* Decade Filter */}
            <FilterDropdown
              value={selectedDecade}
              onValueChange={(v) => { setSelectedDecade(v); setFiltersOpen(false); }}
              placeholder={t('archive.allDecades')}
              options={filterOptions.decades.map((d): FilterDropdownOption => ({ label: d, value: d }))}
              className="lg:w-[140px]"
            />

            {/* Type Filter */}
            <FilterDropdown
              value={selectedType}
              onValueChange={(v) => { setSelectedType(v); setFiltersOpen(false); }}
              placeholder={t('archive.allTypes')}
              options={filterOptions.documentTypes.map((type): FilterDropdownOption => ({
                label: getDocumentTypeLabel(type),
                value: type,
              }))}
              className="lg:w-[160px]"
            />

            {/* Preparation Filter */}
            {filterOptions.preparations.length > 0 && (
              <FilterDropdown
                value={selectedPreparation}
                onValueChange={(v) => { setSelectedPreparation(v); setFiltersOpen(false); }}
                placeholder={t('archive.allPreparations')}
                options={filterOptions.preparations.map((p): FilterDropdownOption => ({ label: p, value: p }))}
                className="lg:w-[140px]"
              />
            )}

            {/* Tag Filter (keywords) — multi-select */}
            {filterOptions.keywords.length > 0 && (
              <FilterDropdownMulti
                selected={selectedTags}
                onToggle={(tag) => {
                  setSelectedTags((prev) =>
                    prev.includes(tag)
                      ? prev.filter((t) => t !== tag)
                      : [...prev, tag].sort(),
                  );
                }}
                placeholder={t('archive.allTags')}
                options={filterOptions.keywords.map((k): FilterDropdownOption => ({ label: k, value: k }))}
                className="lg:w-[160px]"
              />
            )}

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAllFilters}
                className="col-span-2 lg:col-span-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4 mr-1" />
                {t('common.clearAll')}
              </Button>
            )}
          </div>

          {/* Active Filters Display */}
          {hasActiveFilters && (
            <div className="flex flex-wrap gap-2" role="list" aria-label={t('archive.filter')}>
              {selectedDecade && (
                <Badge variant="secondary" className="flex items-center gap-1">
                  {selectedDecade}
                  <button onClick={() => setSelectedDecade(null)} aria-label={`${t('common.clearAll')}: ${selectedDecade}`}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
              {selectedType && (
                <Badge variant="secondary" className="flex items-center gap-1">
                  {getDocumentTypeLabel(selectedType)}
                  <button onClick={() => setSelectedType(null)} aria-label={`${t('common.clearAll')}: ${getDocumentTypeLabel(selectedType)}`}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
              {selectedPreparation && (
                <Badge variant="secondary" className="flex items-center gap-1">
                  {selectedPreparation}
                  <button onClick={() => setSelectedPreparation(null)} aria-label={`${t('common.clearAll')}: ${selectedPreparation}`}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
              {selectedTags.map((tag) => (
                <Badge key={tag} variant="secondary" className="flex items-center gap-1">
                  {tag}
                  <button
                    onClick={() =>
                      setSelectedTags((prev) => prev.filter((t) => t !== tag))
                    }
                    aria-label={`${t('common.clearAll')}: ${tag}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              {searchQuery && (
                <Badge variant="secondary" className="flex items-center gap-1">
                  {`\u201C${searchQuery}\u201D`}
                  <button onClick={() => setSearchQuery("")} aria-label={`${t('common.clearAll')}: ${searchQuery}`}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Document Grid */}
      <section ref={documentGridRef} className="py-16 scroll-mt-40 lg:scroll-mt-24">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          {/* Result count */}
          {hasActiveFilters && !loading && (
            <p className="text-sm text-muted-foreground mb-6">
              {t('archive.resultCount', { count: documents.length })}
            </p>
          )}

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-card border border-border rounded-lg overflow-hidden">
                  <Skeleton className="aspect-[4/3] w-full" />
                  <div className="p-5 space-y-3">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                    <div className="flex gap-2 pt-2">
                      <Skeleton className="h-5 w-16 rounded-full" />
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {documents.map((doc) => {
                const IconComponent = typeIcons[doc.document_type] || FileText;
                const title = getLocalizedField(doc, 'title', currentLocale) || doc.title;
                const description = getLocalizedField(doc, 'description', currentLocale) || getLocalizedSummary(doc, currentLocale);
                
                return (
                  <Link
                    key={doc.id}
                    to={`/archive/${doc.slug}`}
                    className="group bg-card border border-border rounded-lg overflow-hidden hover:shadow-lg hover:border-primary/40 transition-all duration-300 block"
                  >
                    {/* Thumbnail - only show if scan_url exists */}
                    {doc.scan_url && (
                      <div className="aspect-[4/3] relative overflow-hidden">
                        <img
                          src={doc.scan_url}
                          alt={title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                        <div className="absolute top-3 left-3">
                          <Badge variant={badgeVariants[doc.provenance_badge] || "default"}>
                            {badgeLabels[doc.provenance_badge] || doc.provenance_badge}
                          </Badge>
                        </div>
                        <div className="absolute top-3 right-3 bg-background/90 backdrop-blur-sm rounded-full p-2">
                          <IconComponent className="h-4 w-4 text-foreground" />
                        </div>
                        {doc.is_featured && (
                          <div className="absolute bottom-3 right-3">
                            <Badge className="bg-primary text-primary-foreground">{t("archive.badges.featured")}</Badge>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Content */}
                    <div className="p-5">
                      {/* Top badges for documents without image */}
                      {!doc.scan_url && (
                        <div className="flex items-center justify-between mb-3">
                          <Badge variant={badgeVariants[doc.provenance_badge] || "default"}>
                            {badgeLabels[doc.provenance_badge] || doc.provenance_badge}
                          </Badge>
                          <div className="flex items-center gap-2">
                            <div className="bg-muted rounded-full p-2">
                              <IconComponent className="h-4 w-4 text-foreground" />
                            </div>
                            {doc.is_featured && (
                              <Badge className="bg-primary text-primary-foreground">{t("archive.badges.featured")}</Badge>
                            )}
                          </div>
                        </div>
                      )}
                      
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                        {doc.year && (
                          <>
                            <Calendar className="h-3 w-3" />
                            <span>{doc.year}</span>
                          </>
                        )}
                        {doc.source_publication && (
                          <>
                            <span className="text-border">•</span>
                            <span className="truncate max-w-[120px]">{doc.source_publication}</span>
                          </>
                        )}
                        {doc.place && (
                          <>
                            <span className="text-border">•</span>
                            <MapPin className="h-3 w-3" />
                            <span>{doc.place}</span>
                          </>
                        )}
                      </div>
                      
                      <h3 className="font-serif text-lg font-semibold text-foreground mb-2 group-hover:text-primary transition-colors line-clamp-2">
                        {title}
                      </h3>
                      
                      {description && (
                        <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                          {description}
                        </p>
                      )}

                      {doc.people && doc.people.length > 0 && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                          <User className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{doc.people.slice(0, 3).join(", ")}{doc.people.length > 3 && ` +${doc.people.length - 3}`}</span>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2 mb-4">
                        {doc.preparation && (
                          <Badge variant="outline">{doc.preparation}</Badge>
                        )}
                        {doc.keywords && doc.keywords.slice(0, 2).map(keyword => (
                          <Badge key={keyword} variant="secondary" className="text-xs">{keyword}</Badge>
                        ))}
                      </div>

                      <div className="flex items-center justify-between pt-3 border-t border-border/40">
                        <div className="flex items-center gap-1 text-sm font-medium text-primary group-hover:underline">
                          <Eye className="h-4 w-4" />
                          {t('documents.viewDocument')}
                        </div>
                        {(doc.scan_url || doc.transcript_url) && (
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              window.open(doc.scan_url ?? doc.transcript_url ?? undefined, '_blank');
                            }}
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            title={t('common.download')}
                          >
                            <Download className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {!loading && documents.length === 0 && (
            <div className="text-center py-16">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="font-serif text-xl font-semibold mb-2">{t('documents.noDocuments')}</h3>
              <p className="text-muted-foreground mb-4">{t('documents.adjustFilters')}</p>
              {hasActiveFilters && (
                <Button variant="outline" onClick={clearAllFilters}>
                  {t('common.clearAll')}
                </Button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Context Disclaimer */}
      <section className="py-12 bg-muted/50 border-t border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <p className="text-sm text-muted-foreground italic">
              {t('provenance.disclaimer')}
            </p>
            <p className="text-xs text-muted-foreground mt-2">{t('archive.editorialPolicy')}</p>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
