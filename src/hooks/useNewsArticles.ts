/**
 * Hook for reading published news articles (public).
 *
 * Uses RPC function accessible by anon and authenticated users.
 *
 * @example
 * const { articles, isLoading } = useNewsArticles();
 * const { article, isLoading } = useNewsArticleBySlug("mobile-app-beta-testing");
 */

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { aisha } from "@/integrations/db/client";
import { getTranslationLocale } from "@/lib/i18n/locale";
import { safeError } from "@/lib/security/safeLogger";
import { getUserFacingDataErrorMessage } from "@/lib/security/userFacingErrors";
import {
  NewsArticlePublicSchema,
  NewsArticleDetailSchema,
  NewsArticleBrowseSchema,
  NewsTagSchema,
  parseRpcArrayResponse,
} from "@/schemas/rpcResponseSchemas";
import type { NewsArticlePublic, NewsArticleDetail, NewsArticleBrowse, NewsTag } from "@/schemas/rpcResponseSchemas";

export type { NewsArticlePublic, NewsArticleDetail, NewsArticleBrowse, NewsTag };

/**
 * Query options factory for prefetching in router loaders.
 */
export function newsArticlesQueryOptions(limit = 20, offset = 0) {
  return {
    queryKey: ["news-articles", limit, offset] as const,
    queryFn: async (): Promise<NewsArticlePublic[]> => {
      const { data, error } = await aisha.rpc("get_published_news_articles", {
        p_limit: limit,
        p_offset: offset,
      });

      if (error) {
        safeError("news-articles.fetch", error);
        throw new Error(error.message);
      }

      return parseRpcArrayResponse(NewsArticlePublicSchema, data);
    },
  };
}

/**
 * Hook for listing published news articles.
 */
export function useNewsArticles(limit = 20, offset = 0) {
  const query = useQuery(newsArticlesQueryOptions(limit, offset));

  return {
    articles: query.data,
    isLoading: query.isLoading,
    error: query.error,
  };
}

/**
 * Query options for single article by slug.
 */
export function newsArticleBySlugQueryOptions(slug: string) {
  return {
    queryKey: ["news-article", slug] as const,
    queryFn: async (): Promise<NewsArticleDetail | null> => {
      const { data, error } = await aisha.rpc("get_news_article_by_slug", {
        p_slug: slug,
      });

      if (error) {
        safeError("news-article.fetch-by-slug", error);
        throw new Error(error.message);
      }

      const articles = parseRpcArrayResponse(NewsArticleDetailSchema, data);
      return articles[0] ?? null;
    },
    enabled: !!slug,
  };
}

/**
 * Hook for fetching a single published news article by slug.
 */
export function useNewsArticleBySlug(slug: string) {
  const query = useQuery(newsArticleBySlugQueryOptions(slug));

  return {
    article: query.data,
    isLoading: query.isLoading,
    error: query.error,
  };
}

// ── Dynamic archive/blog browse (parameterized, backend-filtered) ───────────

export type NewsSort = "recent" | "oldest" | "alpha" | "featured";

export interface NewsBrowseFilters {
  search?: string;
  tags?: string[];
  sort?: NewsSort;
  limit?: number;
  offset?: number;
}

/**
 * Query options for the dynamic, parameterized article listing. Filters are
 * applied in the BACKEND (get_published_news_articles_filtered) — articles are
 * never manually placed in a list. The queryKey carries every filter so each
 * filter combination caches independently.
 */
export function newsArticlesBrowseQueryOptions(
  filters: NewsBrowseFilters = {},
  locale?: string,
) {
  const tags = (filters.tags ?? []).filter((tag) => tag.trim().length > 0);
  return {
    // ⛔ LOCALE PATŘÍ DO KLÍČE CACHE (2026-09-21). Listing podle něj řadí abecedně
    // (titulek žije v `translations` pro každý jazyk zvlášť), takže bez locale
    // v klíči by si dva jazyky sdílely jednu odpověď a druhý by dostal cizí pořadí.
    queryKey: [
      "news-browse",
      filters.search?.trim() ?? null,
      [...tags].sort().join("|"),
      filters.sort ?? "recent",
      filters.limit ?? 24,
      filters.offset ?? 0,
      locale ?? null,
    ] as const,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<NewsArticleBrowse[]> => {
      // Parametry ABECEDNĚ — drží to test `rpc-params-alphabetical` (čitelnost proti
      // překlepům v dlouhých seznamech). `p_locale` proto patří za `p_limit`, ne na konec.
      const { data, error } = await aisha.rpc("get_published_news_articles_filtered", {
        p_limit: filters.limit ?? 24,
        // Bez locale se abecední řazení nemá o co opřít (funkce ŽÁDNÝ jazyk
        // nedosazuje) — proto ho klient posílá vždycky.
        p_locale: locale,
        p_offset: filters.offset ?? 0,
        p_search: filters.search?.trim() || undefined,
        p_sort: filters.sort ?? "recent",
        p_tags: tags.length > 0 ? tags : undefined,
      });
      if (error) {
        safeError("news-browse.fetch", error);
        throw new Error(error.message);
      }
      return parseRpcArrayResponse(NewsArticleBrowseSchema, data);
    },
  };
}

/** Hook for the dynamic archive/blog browser block — backend-filtered listing. */
export function useNewsArticlesBrowser(filters: NewsBrowseFilters = {}) {
  const { i18n } = useTranslation();
  const query = useQuery(
    newsArticlesBrowseQueryOptions(filters, getTranslationLocale(i18n.language)),
  );
  return {
    articles: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error ? getUserFacingDataErrorMessage(query.error) : null,
  };
}

/** Hook for the in-use tag catalog (feeds the browser's tag filter). Dynamic. */
export function useNewsTags() {
  const query = useQuery({
    queryKey: ["news-tags"] as const,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<NewsTag[]> => {
      const { data, error } = await aisha.rpc("get_news_tags");
      if (error) {
        safeError("news-tags.fetch", error);
        throw new Error(error.message);
      }
      return parseRpcArrayResponse(NewsTagSchema, data);
    },
  });
  return { tags: query.data ?? [], isLoading: query.isLoading };
}
