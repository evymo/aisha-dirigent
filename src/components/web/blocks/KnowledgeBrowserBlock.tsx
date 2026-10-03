import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { BookOpen, Loader2, Lock, Search, ShieldCheck, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useKnowledgeTopics } from "@/hooks/useKnowledgeBase";

import type { RuntimeBlockProps } from "@/lib/builder/runtimeBlockRegistry";

const VISIBILITY_OPTIONS = ["public", "members"] as const;

/**
 * Runtime block: full knowledge topics browser with search and visibility filter.
 * Supports URL sync for search and visibility.
 * Config: { limit?: number }
 */
export default function KnowledgeBrowserBlock({ config }: RuntimeBlockProps) {
  const { t, i18n } = useTranslation();
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

  const limit = (config?.limit as number) ?? undefined;

  const searchQuery = searchParams.get("q") ?? "";
  const visibilityParam = searchParams.get("visibility") ?? "";

  const updateParam = (key: string, value: string) => {
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

  const { data: topics, isLoading } = useKnowledgeTopics({
    limit,
    locale: i18n.language,
    offset: 0,
    search: searchQuery || undefined,
    visibility: (visibilityParam as "public" | "members") || undefined,
  });

  const hasActiveFilters = Boolean(searchQuery || visibilityParam);

  const clearAll = () => {
    setSearchParams({}, NAVIGACE);
  };

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder={t("knowledge.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => updateParam("q", e.target.value)}
          />
        </div>
        <Select
          value={visibilityParam || "all"}
          onValueChange={(v) => updateParam("visibility", v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t("knowledge.allVisibility")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("knowledge.allVisibility")}</SelectItem>
            {VISIBILITY_OPTIONS.map((v) => (
              <SelectItem key={v} value={v}>
                {t(`knowledge.visibility.${v}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            <X className="h-4 w-4 mr-1" />
            {t("common.clearAll")}
          </Button>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : !topics?.length ? (
        <div className="text-center py-12 text-muted-foreground">
          {t("knowledge.emptyState")}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {topics.map((topic) => (
            <Link
              key={topic.id}
              to={`/knowledge/${topic.slug}`}
              className="group block rounded-xl border bg-card p-5 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-center gap-2 mb-2">
                {topic.visibility === "members" && (
                  <Lock className="h-4 w-4 text-amber-500" />
                )}
                {topic.verification_status === "verified" && (
                  <ShieldCheck className="h-4 w-4 text-green-600" />
                )}
                <Badge variant="outline" className="text-xs">
                  {topic.source_locale}
                </Badge>
              </div>
              <h3 className="font-semibold text-lg mb-2 group-hover:text-primary transition-colors line-clamp-2">
                {topic.title}
              </h3>
              {topic.summary && (
                <p className="text-sm text-muted-foreground line-clamp-3 mb-3">
                  {topic.summary}
                </p>
              )}
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <BookOpen className="h-3.5 w-3.5" />
                <span>
                  {t("knowledge.postCount", { count: topic.post_count })}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
