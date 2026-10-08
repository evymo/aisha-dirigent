/**
 * Správa štítků novinek (2026-10-02, z instance — správkyně webu spravuje štítky sama):
 * přehled všech štítků (i z nezveřejněných článků a konceptů), přejmenování /
 * sloučení a zobrazované názvy po jazycích (translations, namespace `news-tags`,
 * klíč = hodnota štítku — tak je čte web, viz lib/novinky/stitky.ts).
 *
 * @module
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { NAMESPACE_STITKU } from "@/lib/novinky/stitky";
import { safeError } from "@/lib/security/safeLogger";
import { ADMIN_NEWS_QUERY_KEY } from "@/hooks/useAdminNewsArticles";

export interface StitekAdmin {
  tag: string;
  article_count: number;
  published_count: number;
}

/** Všechny štítky s počty (admin/staff). */
export function useNewsTagsAdmin(zapnuto = true) {
  return useQuery({
    enabled: zapnuto,
    queryKey: ["admin-news-tags"],
    staleTime: 30 * 1000,
    queryFn: async (): Promise<StitekAdmin[]> => {
      const { data, error } = await aisha.rpc("get_news_tags_admin");
      if (error) throw new Error(error.message);
      return ((data ?? []) as Array<{ tag: string; article_count: number | string; published_count: number | string }>).map((r) => ({
        tag: r.tag,
        article_count: Number(r.article_count),
        published_count: Number(r.published_count),
      }));
    },
  });
}

/** Zobrazované názvy štítků: štítek → jazyk → název. */
export function useNewsTagNames(stitky: string[]) {
  return useQuery({
    enabled: stitky.length > 0,
    queryKey: ["admin-news-tag-names", stitky.join(",")],
    staleTime: 30 * 1000,
    queryFn: async (): Promise<Record<string, Record<string, string>>> => {
      const { data, error } = await aisha.rpc("get_translations_for_keys", {
        p_keys: stitky,
        p_namespace: NAMESPACE_STITKU,
      });
      if (error) throw new Error(error.message);
      const mapa: Record<string, Record<string, string>> = {};
      for (const r of (data ?? []) as Array<{ key: string; locale: string; value: string }>) {
        (mapa[r.key] ??= {})[r.locale] = r.value;
      }
      return mapa;
    },
  });
}

/** Přejmenuje štítek; existuje-li cílový, sloučí je. Vrací počet změněných článků. */
export function useRenameNewsTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ z, na }: { z: string; na: string }): Promise<number> => {
      const { data, error } = await aisha.rpc("rename_news_tag_admin", { p_from: z, p_to: na });
      if (error) throw new Error(error.message);
      return Number(data ?? 0);
    },
    onError: (error) => safeError("admin.news.tags.rename.failed", error),
    onSuccess: () => {
      for (const klic of ["admin-news-tags", "admin-news-tag-names", ADMIN_NEWS_QUERY_KEY, "admin-news-article", "news-tags", "news-browse", "news-articles", "dynamic-t-map"]) {
        queryClient.invalidateQueries({ queryKey: [klic] });
      }
    },
  });
}
