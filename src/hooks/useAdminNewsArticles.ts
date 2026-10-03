/**
 * Hook for admin CRUD operations on news articles.
 *
 * Uses RPC functions with admin guard and Zod validation.
 *
 * 2026-09-24 — koncept, zveřejnění, souběh:
 *   • seznam nese titulek v jazyce rozhraní (`p_locale`), štítky a `has_draft`;
 *   • OBSAH (obrázek, ohnisko, štítky, texty, plátno) jde přes
 *     `save_news_article_draft_admin` — server rozhodne, zda do konceptu
 *     (zveřejněný článek), nebo živě (nezveřejněný);
 *   • STRUKTURA (slug, pořadí, zveřejnit/stáhnout) jde přes
 *     `update_news_article_admin`;
 *   • každý zápis nese `expected_stamp` z načtení; nesedí-li, server vrátí 409
 *     a hook ho nese dál jako ChybaUlozeniClanku (jeKonfliktUlozeni).
 *
 * @example
 * const { articles, createArticleAsync, saveDraftAsync, publishAsync } = useAdminNewsArticles();
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "@/hooks/useSession";
import { usePermissions } from "@/hooks/usePermissions";
import { useAdminGuard } from "@/hooks/useAdminGuard";
import { getTranslationLocale } from "@/lib/i18n/locale";
import { chybaZRpc } from "@/lib/novinky/konflikt";
import { safeError } from "@/lib/security/safeLogger";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { NewsArticleAdminSchema, parseRpcArrayResponse } from "@/schemas/rpcResponseSchemas";
import type { NewsArticleAdmin, NewsArticleFields } from "@/schemas/rpcResponseSchemas";

export type { NewsArticleAdmin, NewsArticleFields };

export interface NewsArticlePayload {
  id?: string;
  content_key?: string;
  excerpt_key?: string;
  /** Razítko z načtení (edit_stamp); bez něj server souběh nekontroluje. */
  expected_stamp?: string | null;
  image_url?: string | null;
  image_focus_x?: number;
  image_focus_y?: number;
  image_zoom?: number;
  is_published?: boolean;
  published_at?: string | null;
  slug?: string;
  sort_order?: number;
  tags?: string[];
  title_key?: string;
}

export interface SaveDraftInput {
  id: string;
  expectedStamp: string | null;
  fields?: NewsArticleFields;
  canvas?: { canvas_data?: unknown; canvas_html?: string; canvas_css?: string };
}

export interface PublishInput {
  id: string;
  expectedStamp: string | null;
  fields?: NewsArticleFields;
}

export const ADMIN_NEWS_QUERY_KEY = "admin-news-articles";

export function useAdminNewsArticles() {
  const { user, isLoading: sessionLoading } = useSession();
  const { hasPermission } = usePermissions();
  const { guardAdminMutation } = useAdminGuard();
  const isAdmin = hasPermission("view_admin_dashboard");
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation();
  const locale = getTranslationLocale(i18n.language);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [ADMIN_NEWS_QUERY_KEY] });
    queryClient.invalidateQueries({ queryKey: ["admin-news-article"] });
    queryClient.invalidateQueries({ queryKey: ["news-articles"] });
    queryClient.invalidateQueries({ queryKey: ["news-browse"] });
    queryClient.invalidateQueries({ queryKey: ["news-article"] });
  };

  const query = useQuery({
    // Locale je v klíči: titulek se čte v jazyce rozhraní.
    queryKey: [ADMIN_NEWS_QUERY_KEY, locale],
    queryFn: async (): Promise<NewsArticleAdmin[]> => {
      if (!isAdmin || !user) return [];
      const { data, error } = await aisha.rpc("get_news_articles_admin", { p_locale: locale });

      if (error) {
        safeError("admin-news-articles.fetch", error);
        throw new Error(error.message);
      }

      return parseRpcArrayResponse(NewsArticleAdminSchema, data);
    },
    enabled: !!user && !sessionLoading && isAdmin,
  });

  const createMutation = useMutation({
    mutationFn: guardAdminMutation("create_news_article_admin", async (data: NewsArticlePayload) => {
      const { data: id, error } = await aisha.rpc("create_news_article_admin", {
        p_content_key: data.content_key ?? "",
        p_excerpt_key: data.excerpt_key ?? undefined,
        p_image_focus_x: data.image_focus_x ?? undefined,
        p_image_focus_y: data.image_focus_y ?? undefined,
        p_image_url: data.image_url ?? undefined,
        p_image_zoom: data.image_zoom ?? undefined,
        p_is_published: data.is_published ?? false,
        p_published_at: data.published_at ?? undefined,
        p_slug: data.slug ?? undefined,
        p_sort_order: data.sort_order ?? 0,
        p_tags: data.tags ?? undefined,
        p_title_key: data.title_key ?? undefined,
      });

      if (error) {
        safeError("admin-news-articles.create", error);
        throw chybaZRpc(error);
      }

      return id as string;
    }),
    onSuccess: () => {
      invalidate();
      toast.success(t("admin.newsArticles.created"));
    },
    onError: () => {
      toast.error(t("admin.newsArticles.errors.createFailed"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: guardAdminMutation("update_news_article_admin", async ({ id, data }: { id: string; data: Partial<NewsArticlePayload> }) => {
      const { data: stamp, error } = await aisha.rpc("update_news_article_admin", {
        p_content_key: data.content_key ?? undefined,
        p_excerpt_key: data.excerpt_key ?? undefined,
        p_expected_stamp: data.expected_stamp ?? undefined,
        p_id: id,
        p_image_url: data.image_url ?? undefined,
        p_is_published: data.is_published,
        p_published_at: data.published_at ?? undefined,
        p_slug: data.slug ?? undefined,
        p_sort_order: data.sort_order,
        p_title_key: data.title_key ?? undefined,
      });

      if (error) {
        safeError("admin-news-articles.update", error);
        throw chybaZRpc(error);
      }
      return stamp as string;
    }),
    onSuccess: () => {
      invalidate();
      toast.success(t("admin.newsArticles.updated"));
    },
    // Konflikt hlásí volající (nabídne načíst/přepsat), obecná chyba tady.
    onError: (err) => {
      if (!isKonflikt(err)) toast.error(t("admin.newsArticles.errors.updateFailed"));
    },
  });

  const saveDraftMutation = useMutation({
    mutationFn: guardAdminMutation("save_news_article_draft_admin", async (input: SaveDraftInput) => {
      const { data: stamp, error } = await aisha.rpc("save_news_article_draft_admin", {
        p_article_id: input.id,
        p_canvas_css: input.canvas?.canvas_css ?? undefined,
        p_canvas_data: (input.canvas?.canvas_data as never) ?? undefined,
        p_canvas_html: input.canvas?.canvas_html ?? undefined,
        p_expected_stamp: input.expectedStamp ?? undefined,
        p_fields: (input.fields as never) ?? undefined,
      });
      if (error) {
        safeError("admin-news-articles.save-draft", error);
        throw chybaZRpc(error);
      }
      return stamp as string;
    }),
    onSuccess: () => invalidate(),
    onError: (err) => {
      if (!isKonflikt(err)) toast.error(t("admin.newsArticles.errors.draftFailed"));
    },
  });

  const publishMutation = useMutation({
    mutationFn: guardAdminMutation("publish_news_article_admin", async (input: PublishInput) => {
      const { data: stamp, error } = await aisha.rpc("publish_news_article_admin", {
        p_article_id: input.id,
        p_expected_stamp: input.expectedStamp ?? undefined,
        p_fields: (input.fields as never) ?? undefined,
      });
      if (error) {
        safeError("admin-news-articles.publish", error);
        throw chybaZRpc(error);
      }
      return stamp as string;
    }),
    onSuccess: () => {
      invalidate();
      toast.success(t("admin.newsArticles.publishedChanges"));
    },
    onError: (err) => {
      if (!isKonflikt(err)) toast.error(t("admin.newsArticles.errors.publishFailed"));
    },
  });

  const discardDraftMutation = useMutation({
    mutationFn: guardAdminMutation("discard_news_article_draft_admin", async (id: string) => {
      const { data: stamp, error } = await aisha.rpc("discard_news_article_draft_admin", { p_article_id: id });
      if (error) {
        safeError("admin-news-articles.discard-draft", error);
        throw chybaZRpc(error);
      }
      return stamp as string;
    }),
    onSuccess: () => {
      invalidate();
      toast.success(t("admin.newsArticles.draftDiscarded"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: guardAdminMutation("delete_news_article_admin", async (id: string) => {
      const { error } = await aisha.rpc("delete_news_article_admin", { p_id: id });

      if (error) {
        safeError("admin-news-articles.delete", error);
        throw new Error(error.message);
      }
    }),
    onSuccess: () => {
      invalidate();
      toast.success(t("admin.newsArticles.deleted"));
    },
    onError: () => {
      toast.error(t("admin.newsArticles.errors.deleteFailed"));
    },
  });

  return {
    articles: query.data,
    isLoading: query.isLoading || sessionLoading,
    createArticle: createMutation.mutate,
    createArticleAsync: createMutation.mutateAsync,
    updateArticle: updateMutation.mutate,
    updateArticleAsync: updateMutation.mutateAsync,
    saveDraftAsync: saveDraftMutation.mutateAsync,
    publishAsync: publishMutation.mutateAsync,
    discardDraftAsync: discardDraftMutation.mutateAsync,
    deleteArticle: deleteMutation.mutate,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isSavingDraft: saveDraftMutation.isPending,
    isPublishing: publishMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}

function isKonflikt(err: unknown): boolean {
  const e = err as { status?: number; code?: string; message?: string } | null;
  return e?.status === 409 || e?.code === "PT409" || /PT409/.test(e?.message ?? "");
}
