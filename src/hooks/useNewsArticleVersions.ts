/**
 * Historie článku novinek — zrcadlí usePageVersions (web stránky).
 * Obnova jde u zveřejněného článku do KONCEPTU (web se nezmění), u nezveřejněného
 * živě; rozhoduje server (restore_news_article_version). Vrací nové razítko.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { chybaZRpc } from "@/lib/novinky/konflikt";
import { safeError } from "@/lib/security/safeLogger";
import { NewsArticleVersionSchema, parseRpcArrayResponse, type NewsArticleVersion } from "@/schemas/rpcResponseSchemas";

export type { NewsArticleVersion };

export const NEWS_VERSIONS_KEY = "news-article-versions";

export function useNewsArticleVersions(articleId: string | undefined) {
  return useQuery({
    queryKey: [NEWS_VERSIONS_KEY, articleId] as const,
    enabled: !!articleId,
    staleTime: 30_000,
    queryFn: async (): Promise<NewsArticleVersion[]> => {
      const { data, error } = await aisha.rpc("get_news_article_versions", { p_article_id: articleId! });
      if (error) {
        safeError("news-article-versions.fetch", error);
        throw new Error(error.message);
      }
      return parseRpcArrayResponse(NewsArticleVersionSchema, data);
    },
  });
}

export function useRestoreNewsArticleVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ articleId, versionId }: { articleId: string; versionId: string }): Promise<string> => {
      const { data, error } = await aisha.rpc("restore_news_article_version", {
        p_article_id: articleId,
        p_version_id: versionId,
      });
      if (error) {
        safeError("news-article-versions.restore", error);
        throw chybaZRpc(error);
      }
      return data as string;
    },
    onSuccess: (_stamp, vars) => {
      qc.invalidateQueries({ queryKey: [NEWS_VERSIONS_KEY, vars.articleId] });
      qc.invalidateQueries({ queryKey: ["admin-news-article", vars.articleId] });
      qc.invalidateQueries({ queryKey: ["admin-news-articles"] });
    },
  });
}
