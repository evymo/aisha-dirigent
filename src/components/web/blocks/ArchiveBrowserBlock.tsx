import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import {
  BookText,
  Download,
  FileText,
  Loader2,
  Search,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FilterDropdown,
  FilterDropdownMulti,
} from "@/components/ui/filter-dropdown";
import { useArchiveDocuments } from "@/hooks";
import { useArchiveFilterOptions } from "@/hooks/useArchiveDocuments";
import { useDebounce } from "@/hooks/useDebounce";

import type { RuntimeBlockProps } from "@/lib/builder/runtimeBlockRegistry";

/** Icon map matching the original Archive page */
const DOC_TYPE_ICONS: Record<string, typeof FileText> = {
  manuscript: BookText,
  protocol: FileText,
  report: FileText,
};

/**
 * Runtime block: full archive browser with 4-axis filtering (decade, type, preparation, keywords),
 * URL-synced search, and document card grid with links to detail.
 */
export default function ArchiveBrowserBlock({ config: _config }: RuntimeBlockProps) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  // POZOR: FILTROVÁNÍ NENÍ NAVIGACE (naměřeno 2026-09-01 na živém webu).
  //
  // `setSearchParams` je ve výchozím stavu PUSH navigace a `ScrollRestoration`
  // v RootLayoutu podle klíče nové lokace se stránkou hýbe — při psaní do
  // filtru to čtenář vidí jako poskakování. Změřeno na seznamu novinek:
  // scroll se posunul z 1400 na 676, zatímco počet karet zůstal 24.
  //
  // `preventScrollReset` je vlajka Reactu Routeru přesně na tenhle případ.
  // `replace` řeší druhou, tišší vadu: bez něj přibude do historie záznam za
  // KAŽDÉ písmeno. Filtr je stav pohledu, ne krok v cestě webem.
  const NAVIGACE = { preventScrollReset: true, replace: true } as const;

  const gridRef = useRef<HTMLDivElement>(null);

  // URL state
  const decade = searchParams.get("decade") ?? "";
  const documentType = searchParams.get("type") ?? "";
  const preparation = searchParams.get("prep") ?? "";
  const selectedTags = searchParams.getAll("tag");
  const rawSearch = searchParams.get("q") ?? "";
  const debouncedSearch = useDebounce(rawSearch, 300);

  const updateParam = (key: string, value: string | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      return next;
    }, NAVIGACE);
  };

  const toggleTag = (tag: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const currentTags = next.getAll("tag");
      next.delete("tag");
      if (currentTags.includes(tag)) {
        currentTags.filter((t) => t !== tag).forEach((t) => next.append("tag", t));
      } else {
        currentTags.forEach((t) => next.append("tag", t));
        next.append("tag", tag);
      }
      return next;
    }, NAVIGACE);
  };

  const clearAll = () => {
    setSearchParams({}, NAVIGACE);
  };

  // Data fetching
  const { filterOptions, loading: filtersLoading } = useArchiveFilterOptions();
  const { documents, loading } = useArchiveDocuments({
    decade: decade || null,
    documentType: documentType || null,
    keywords: selectedTags.length > 0 ? selectedTags : null,
    preparation: preparation || null,
    searchQuery: debouncedSearch || undefined,
  });

  const hasActiveFilters = Boolean(
    decade || documentType || preparation || selectedTags.length || rawSearch
  );

  // Filter option lists
  const decadeOptions = (filterOptions?.decades ?? []).map((d) => ({
    label: d,
    value: d,
  }));
  const typeOptions = (filterOptions?.documentTypes ?? []).map((dt) => ({
    label: t(`archive.documentType.${dt}`, dt),
    value: dt,
  }));
  const prepOptions = (filterOptions?.preparations ?? []).map((p) => ({
    label: t(`archive.preparation.${p}`, p),
    value: p,
  }));
  const keywordOptions = (filterOptions?.keywords ?? []).map((k) => ({
    label: k,
    value: k,
  }));

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b py-3 -mx-4 px-4 sm:mx-0 sm:px-0 sm:border sm:rounded-lg sm:p-4">
        <div className="flex flex-col gap-3">
          {/* Search row */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder={t("archive.searchPlaceholder")}
              value={rawSearch}
              onChange={(e) => updateParam("q", e.target.value || null)}
            />
          </div>

          {/* Dropdowns row */}
          <div className="flex flex-wrap gap-2">
            <FilterDropdown
              value={decade || null}
              onValueChange={(v) => updateParam("decade", v)}
              placeholder={t("archive.filter.decade")}
              options={decadeOptions}
              allLabel={t("archive.filter.allDecades")}
            />
            <FilterDropdown
              value={documentType || null}
              onValueChange={(v) => updateParam("type", v)}
              placeholder={t("archive.filter.type")}
              options={typeOptions}
              allLabel={t("archive.filter.allTypes")}
            />
            <FilterDropdown
              value={preparation || null}
              onValueChange={(v) => updateParam("prep", v)}
              placeholder={t("archive.filter.preparation")}
              options={prepOptions}
              allLabel={t("archive.filter.allPreparations")}
            />
            <FilterDropdownMulti
              selected={selectedTags}
              onToggle={toggleTag}
              placeholder={t("archive.filter.keywords")}
              options={keywordOptions}
            />
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                className="text-muted-foreground"
              >
                <X className="h-4 w-4 mr-1" />
                {t("common.clearAll")}
              </Button>
            )}
          </div>

          {/* Active filter badges */}
          {hasActiveFilters && (
            <div className="flex flex-wrap gap-1.5">
              {decade && (
                <Badge variant="secondary" className="gap-1">
                  {decade}
                  <X
                    className="h-3 w-3 cursor-pointer"
                    onClick={() => updateParam("decade", null)}
                  />
                </Badge>
              )}
              {documentType && (
                <Badge variant="secondary" className="gap-1">
                  {t(`archive.documentType.${documentType}`, documentType)}
                  <X
                    className="h-3 w-3 cursor-pointer"
                    onClick={() => updateParam("type", null)}
                  />
                </Badge>
              )}
              {preparation && (
                <Badge variant="secondary" className="gap-1">
                  {preparation}
                  <X
                    className="h-3 w-3 cursor-pointer"
                    onClick={() => updateParam("prep", null)}
                  />
                </Badge>
              )}
              {selectedTags.map((tag) => (
                <Badge key={tag} variant="secondary" className="gap-1">
                  {tag}
                  <X
                    className="h-3 w-3 cursor-pointer"
                    onClick={() => toggleTag(tag)}
                  />
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Grid */}
      <div ref={gridRef}>
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-64 rounded-xl" />
            ))}
          </div>
        ) : !documents?.length ? (
          <div className="text-center py-12 text-muted-foreground">
            {t("archive.emptyState")}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {documents.map((doc) => {
              const DocIcon =
                DOC_TYPE_ICONS[doc.document_type] ?? FileText;

              return (
                <Link
                  key={doc.id}
                  to={`/archive/${doc.slug}`}
                  className="group block rounded-xl border bg-card overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                >
                  {doc.scan_url && (
                    <div className="aspect-[4/3] bg-muted overflow-hidden">
                      <img
                        src={doc.scan_url}
                        alt={doc.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />
                    </div>
                  )}
                  <div className="p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <DocIcon className="h-4 w-4 text-muted-foreground" />
                      {doc.provenance_badge && (
                        <Badge variant="outline" className="text-xs">
                          {doc.provenance_badge}
                        </Badge>
                      )}
                      {doc.year && (
                        <span className="text-xs text-muted-foreground">
                          {doc.year}
                        </span>
                      )}
                      {doc.place && (
                        <span className="text-xs text-muted-foreground">
                          {doc.place}
                        </span>
                      )}
                    </div>
                    <h3 className="font-semibold line-clamp-2 group-hover:text-primary transition-colors">
                      {doc.title}
                    </h3>
                    {doc.summary && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {doc.summary}
                      </p>
                    )}
                    {doc.keywords?.length ? (
                      <div className="flex flex-wrap gap-1">
                        {doc.keywords.slice(0, 3).map((kw) => (
                          <Badge
                            key={kw}
                            variant="outline"
                            className="text-xs"
                          >
                            {kw}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between pt-1">
                      <Button variant="outline" size="sm">
                        {t("archive.viewDocument")}
                      </Button>
                      {doc.is_download_public && doc.storage_path && (
                        <Download className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
