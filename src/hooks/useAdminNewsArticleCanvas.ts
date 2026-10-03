/**
 * Admin hooks for authoring a news article's GrapesJS canvas — the article-side
 * wiring into the shared CanvasEditor. Mirrors the web-page canvas hooks so an
 * article is edited (and made multilingual via string extraction) identically
 * to a page, with no duplicated editor.
 *
 * 2026-09-24: načtení nese i KONCEPT (`draft`) a razítko (`edit_stamp`); zápis
 * razítko posílá zpět a dostane nové. U zveřejněného článku jde uložení do
 * konceptu (server), zveřejnění ho přelije — web nikdy nevidí rozepsanou větu.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { chybaZRpc } from "@/lib/novinky/konflikt";
import { safeError } from "@/lib/security/safeLogger";
import { toJson } from "@/lib/types/json";
import {
  NewsArticleAdminCanvasSchema,
  parseRpcArrayResponse,
} from "@/schemas/rpcResponseSchemas";
import type { NewsArticleAdminCanvas, NewsArticleDraft } from "@/schemas/rpcResponseSchemas";

export type { NewsArticleAdminCanvas, NewsArticleDraft };

export interface UpdateNewsArticleCanvasInput {
  id: string;
  canvas_data: unknown;
  canvas_html: string;
  canvas_css: string;
  publish: boolean;
  /** Razítko z načtení (edit_stamp); null = bez kontroly souběhu (přepsat). */
  expected_stamp: string | null;
}

/** Load a single article by id (incl. canvas + draft state) for the editor. */
export function useAdminNewsArticle(id: string) {
  return useQuery({
    queryKey: ["admin-news-article", id] as const,
    enabled: !!id,
    // Editor load — keep it stable while authoring; the editor owns canvas state
    // after hydration, so we don't want a background refetch mid-edit.
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<NewsArticleAdminCanvas | null> => {
      const { data, error } = await aisha.rpc("get_news_article_admin", { p_id: id });
      if (error) {
        safeError("admin-news-article.fetch", error);
        throw new Error(error.message);
      }
      const rows = parseRpcArrayResponse(NewsArticleAdminCanvasSchema, data);
      return rows[0] ?? null;
    },
  });
}

/** Persist the article canvas via the audited admin RPC; returns the new edit stamp. */
export function useUpdateNewsArticleCanvas() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateNewsArticleCanvasInput): Promise<string> => {
      const { data, error } = await aisha.rpc("update_news_article_canvas_admin", {
        p_canvas_css: input.canvas_css,
        p_canvas_data: toJson(input.canvas_data),
        p_canvas_html: input.canvas_html,
        p_expected_stamp: input.expected_stamp ?? undefined,
        p_id: input.id,
        p_publish: input.publish,
      });
      if (error) {
        safeError("admin-news-article.canvas-update", error);
        throw chybaZRpc(error);
      }
      return data as string;
    },
    onSuccess: (_stamp, input) => {
      // Seznam a veřejné čtení ano; načtení editoru NE — editor drží stav sám
      // a razítko si přebírá z odpovědi (jinak by refetch přepsal plátno pod rukama).
      queryClient.invalidateQueries({ queryKey: ["admin-news-articles"] });
      if (input.publish) {
        queryClient.invalidateQueries({ queryKey: ["news-articles"] });
        queryClient.invalidateQueries({ queryKey: ["news-browse"] });
        queryClient.invalidateQueries({ queryKey: ["news-article"] });
      }
    },
  });
}
