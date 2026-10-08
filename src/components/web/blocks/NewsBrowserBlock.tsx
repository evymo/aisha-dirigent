import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ohniskoZClanku, vyrezObrazku } from "@/lib/media/verejnaAdresaObrazku";
import { Link, useSearchParams } from "react-router-dom";
import { Calendar, Loader2, Search, SlidersHorizontal, User, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FilterDropdown,
  FilterDropdownMulti,
} from "@/components/ui/filter-dropdown";
import { useNewsArticlesBrowser, useNewsTags } from "@/hooks/useNewsArticles";
import type { NewsSort } from "@/hooks/useNewsArticles";
import { useDynamicTranslationsMap } from "@/hooks/useDynamicTranslations";
import { useDebounce } from "@/hooks/useDebounce";
import { NAMESPACE_STITKU, popisekStitku } from "@/lib/novinky/stitky";

import type { RuntimeBlockProps } from "@/lib/builder/runtimeBlockRegistry";

/**
 * Řazení, které knihovna NABÍZÍ.
 *
 * Volba "alpha" tu chvíli NEBYLA (2026-09-21): listing řadil podle `na.title_key`,
 * tedy podle i18n KLÍČE titulku, ne podle titulku — ten žije v `translations` pro
 * každý jazyk zvlášť. Abecední řazení tedy vracelo pořadí podle času vzniku klíče
 * a nabízet volbu, která dělá něco jiného, než slibuje, je horší než ji nenabízet.
 *
 * Vrácena, jakmile listing dostal `p_locale` a řadí podle SKUTEČNÉHO titulku
 * v jazyce čtenáře (hlídá brána `abecedne-radi-podle-titulku`).
 */
const SORTS: NewsSort[] = ["recent", "oldest", "alpha", "featured"];

/**
 * Runtime block: the dynamic archive/blog browser over published articles.
 *
 * This is a PARAMETERIZED listing — its config sets WHAT to list, and the
 * matching articles are pulled from the backend (get_published_news_articles_filtered)
 * on every filter change. Nothing is manually placed in the list. Config:
 *   { limit?: number, showFilters?: boolean, tag?: string }
 * `tag` pins the listing to a single tag (e.g. a "Retreats" page that always
 * shows tag=retreat); `showFilters=false` renders a plain list.
 */
export default function NewsBrowserBlock({ config }: RuntimeBlockProps) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const limit = typeof config?.limit === "number" ? config.limit : 24;
  const showFilters = config?.showFilters !== false;
  const pinnedTag =
    typeof config?.tag === "string" && config.tag.trim() ? config.tag.trim() : null;

  // URL state — shareable, back-button friendly
  const rawSearch = searchParams.get("q") ?? "";
  const debouncedSearch = useDebounce(rawSearch, 300);
  const selectedTags = searchParams.getAll("tag");
  const sort = (searchParams.get("sort") as NewsSort) || "recent";

  // POZOR: FILTROVÁNÍ NENÍ NAVIGACE (naměřeno 2026-09-01 na živém webu).
  //
  // Každý úhoz mění dotaz v adrese, a `setSearchParams` je ve výchozím stavu
  // PUSH navigace. `ScrollRestoration` v RootLayoutu pak podle klíče nové
  // lokace se stránkou hýbe — čtenář to vidí jako poskakování při psaní.
  //
  // Změřeno při psaní „ganapuja" se scrollem na 1400 px; POČET KARET SE
  // NEMĚNIL, hýbal se scroll:
  //     start  výška 5115  scroll 1400  24 karet
  //     +n     výška 5159  scroll 1166  24 karet   ← skok, výška stejná
  //     +a     výška 5993  scroll  676  24 karet   ← druhý skok
  //
  // `preventScrollReset` je vlajka Reactu Routeru přesně na tenhle případ:
  // adresa se změní, ale se scrollem se nehýbe.
  //
  // `replace` řeší druhou, tišší vadu: bez něj přibude do historie záznam za
  // KAŽDÉ písmeno, takže „zpět" po napsání osmi znaků vyžaduje osm stisků.
  // Filtr je stav pohledu, ne krok v cestě webem.
  const NAVIGACE = { preventScrollReset: true, replace: true } as const;

  const updateParam = (key: string, value: string | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, NAVIGACE);
  };

  const toggleTag = (tag: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const current = next.getAll("tag");
      next.delete("tag");
      const updated = current.includes(tag)
        ? current.filter((x) => x !== tag)
        : [...current, tag];
      updated.forEach((x) => next.append("tag", x));
      return next;
    }, NAVIGACE);
  };

  // „All“ ve filtru štítků = zrušit jen výběr štítků (hledání a řazení zůstanou).
  const zrusStitky = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("tag");
      return next;
    }, NAVIGACE);
  };

  const clearAll = () => setSearchParams({}, NAVIGACE);

  // A pinned tag is always applied on top of the user's selection.
  const effectiveTags = pinnedTag ? [pinnedTag, ...selectedTags] : selectedTags;

  const { articles, isLoading } = useNewsArticlesBrowser({
    search: debouncedSearch || undefined,
    tags: effectiveTags.length > 0 ? effectiveTags : undefined,
    sort,
    limit,
  });
  const { tags: tagCatalog } = useNewsTags();

  // Resolve the i18n keys of the visible cards in one batch.
  const translationKeys = articles.flatMap((a) =>
    [a.title_key, a.excerpt_key].filter((k): k is string => !!k)
  );
  const translations = useDynamicTranslationsMap(translationKeys, "news", "en");

  // Názvy štítků: překlad z administrace (namespace news-tags), jinak čitelná
  // podoba hodnoty — návštěvník vidí „People“, ne `people` (2026-09-30).
  const zobrazeneStitky = [
    ...new Set([...tagCatalog.map((tc) => tc.tag), ...selectedTags, ...articles.flatMap((a) => a.tags ?? [])]),
  ];
  const prekladyStitku = useDynamicTranslationsMap(zobrazeneStitky, NAMESPACE_STITKU, "en");
  const nazevStitku = (stitek: string) => popisekStitku(stitek, prekladyStitku);

  const tagOptions = tagCatalog
    .filter((tc) => tc.tag !== pinnedTag)
    .map((tc) => ({ label: `${nazevStitku(tc.tag)} (${tc.usage_count})`, value: tc.tag }));
  const sortOptions = SORTS.map((s) => ({
    label: t(`news.sort.${s}`, s),
    value: s,
  }));
  const hasActiveFilters = Boolean(
    rawSearch || selectedTags.length || sort !== "recent"
  );

  // POZOR: FILTROVÁNÍ NESMÍ HÝBAT STRÁNKOU (naměřeno 2026-09-01 na živém webu).
  //
  // Filtr mění POČET karet, a tím výšku dokumentu. Když se stránka zkrátí pod
  // čtenářovu pozici, prohlížeč mu scroll ořízne — čtenář to vidí jako skok
  // nahoru uprostřed psaní, tedy prvek, který mění výšku pod kurzorem.
  //
  //     13 karet  →  výška 4226 px,  scroll zůstal 1400
  //      0 karet  →  výška 1033 px,  scroll uříznut na 557
  //
  // Propad o 3193 px a posun o 843 px, aniž by čtenář na cokoli sáhl.
  //
  // Řešením není pevná rezerva (ta hádá, kolik je „dost"), ale PODLAHA
  // z reálné výšky nefiltrovaného seznamu: dokud filtr běží, plocha výsledků
  // neklesne pod to, co měla PŘED ním. Po vymazání filtru se podlaha pustí,
  // takže stránka nezůstane zbytečně vysoká.
  const vysledkyRef = useRef<HTMLDivElement>(null);
  const filtrRef = useRef<HTMLDivElement>(null);
  const [podlahaVysky, setPodlahaVysky] = useState(0);
  const filtrovalSe = useRef(false);

  // POZOR: PROTI KOTVENÍ SCROLLU SE NEDÁ VYHRÁT, DÁ SE HO PŘEDEJÍT.
  //
  // Naměřeno 2026-09-01 na produkci: při psaní do filtru se scroll posouval
  // z 1400 na 431, ačkoli `scrollTo`, `scrollBy` ani `scrollIntoView` NIKDO
  // nevolal (ověřeno odposlechem všech tří — zachyceno nula volání).
  // Posun tedy dělá prohlížeč sám: filtrování mění karty NAD čtenářovou
  // pozicí a kotvení scrollu upravuje offset, aby viditelný prvek zůstal.
  //
  // Přebíjet to znamená přetahovat se s prohlížečem o něco, co dělá správně.
  // Levnější je dát čtenáři pevný bod: při PRVNÍM zapnutí filtru se lišta
  // filtru vytáhne pod hlavičku a tam zůstane. Od té chvíle se mění jen
  // výpis POD ní — tedy přesně to, co má filtrování dělat.
  //
  // Jen jednou: opakovaný skok při každém úhozu by byl horší než původní vada.
  useLayoutEffect(() => {
    if (!hasActiveFilters) {
      filtrovalSe.current = false;
      return;
    }
    if (filtrovalSe.current) return;
    filtrovalSe.current = true;
    filtrRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hasActiveFilters]);

  useLayoutEffect(() => {
    const el = vysledkyRef.current;
    if (!el) return;
    // Měří se JEN bez filtru — to je ta výška, kterou má filtrování zachovat.
    // Měřit i během filtrování by podlahu srazilo na první zúžený výsledek.
    if (!hasActiveFilters) setPodlahaVysky(el.getBoundingClientRect().height);
  }, [articles, hasActiveFilters]);

  const formatDate = (dateStr: string | null) =>
    dateStr ? new Date(dateStr).toLocaleDateString() : null;

  return (
    <div className="space-y-6">
      {/*
        Vzdušnější podoba filtru: rám a linka pryč, hledání je oválné pole na
        plovoucí ploše, filtry jsou pilulky vedle sebe a všechno je na střed
        v úzkém sloupci. Sticky vrstva používá TÝŽ jazyk jako lišta webu —
        průsvitno + rozostření — takže obsah pod ní projíždí jako pod sklem,
        místo aby narazil do hrany.

        POZOR: komentář patří SEM, ne dovnitř podmíněného výrazu. Uvnitř
        takového výrazu musí být JEDEN element, a JSX komentář je platný jen
        mezi potomky JSX — jinde rozbije parser.
        (A do textu komentáře se nepíše hvězdička s lomítkem: zavřela by ho
        uprostřed věty. Naměřeno o dva pokusy dřív.)
      */}
      {showFilters && (
        <div
          ref={filtrRef}
          className="sticky top-0 z-40 -mx-4 px-4 py-6 backdrop-blur-xl sm:mx-0 sm:px-0"
          style={{ backgroundColor: "hsl(var(--background) / 0.72)" }}
        >
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-4">
            <div className="relative w-full">
              <Search className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-12 rounded-full border-transparent bg-muted/60 pl-12 pr-5 text-base shadow-sm transition-shadow focus-visible:bg-background focus-visible:shadow-md"
                placeholder={t("news.searchPlaceholder", "Search articles…")}
                value={rawSearch}
                onChange={(e) => updateParam("q", e.target.value || null)}
              />
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {/*
                Popisek řady filtrů — bez něj jsou to tři osiřelé pilulky, u
                kterých není poznat, co dělají. Předloha (archiv jednoho z forků)
                má u nich totéž. Na úzkém okně se skryje: tam mluví samotné
                popisky v pilulkách a místo je vzácnější než nápověda.
              */}
              <span className="mr-1 hidden items-center gap-1.5 text-sm text-muted-foreground sm:inline-flex">
                <SlidersHorizontal className="h-4 w-4" />
                {t("news.filter.label", "Filtr")}
              </span>
              <FilterDropdownMulti
                selected={selectedTags}
                onToggle={toggleTag}
                placeholder={t("news.filter.tags", "Tags")}
                options={tagOptions}
                allLabel={t("news.filter.allTags", "All")}
                onClearAll={zrusStitky}
              />
              <FilterDropdown
                value={sort !== "recent" ? sort : null}
                onValueChange={(v) => updateParam("sort", v)}
                placeholder={t("news.filter.sort", "Sort")}
                options={sortOptions}
                allLabel={t("news.sort.recent", "Most recent")}
              />
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAll}
                  className="text-muted-foreground"
                >
                  <X className="h-4 w-4 mr-1" />
                  {t("common.clearAll", "Clear all")}
                </Button>
              )}
            </div>
            {selectedTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedTags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1">
                    {nazevStitku(tag)}
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
      )}

      <div ref={vysledkyRef} style={podlahaVysky ? { minHeight: podlahaVysky } : undefined}>
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : !articles.length ? (
        <div className="text-center py-12 text-muted-foreground">
          {t("news.emptyState", "No articles found.")}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {articles.map((article) => {
            const title = translations[article.title_key] ?? article.title_key;
            const excerpt = article.excerpt_key
              ? translations[article.excerpt_key] ?? null
              : null;
            const date = formatDate(article.published_at);

            return (
              <Link
                key={article.id}
                to={`/news/${article.slug}`}
                className="group block rounded-xl border bg-card overflow-hidden shadow-sm hover:shadow-md transition-shadow"
              >
                {article.image_url && (
                  <div className="aspect-[16/9] bg-muted overflow-hidden">
                    <img
                      src={vyrezObrazku(article.image_url, { w: 960, h: 540, ...ohniskoZClanku(article) }) ?? undefined}
                      alt=""
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                  </div>
                )}
                <div className="p-4 space-y-2">
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {date && (
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {date}
                      </span>
                    )}
                    {article.author_display_name && (
                      <span className="inline-flex items-center gap-1">
                        <User className="h-3.5 w-3.5" />
                        {article.author_display_name}
                      </span>
                    )}
                  </div>
                  <h3 className="font-semibold line-clamp-2 group-hover:text-primary transition-colors">
                    {title}
                  </h3>
                  {excerpt && (
                    <p className="text-sm text-muted-foreground line-clamp-3">
                      {excerpt}
                    </p>
                  )}
                  {article.tags?.length ? (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {article.tags.slice(0, 3).map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs">
                          {nazevStitku(tag)}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
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
