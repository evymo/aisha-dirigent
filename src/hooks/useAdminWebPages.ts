/**
 * Admin hooks for web page CRUD operations.
 *
 * Provides query and mutation hooks for the /admin/pages interface:
 * - useAdminWebPages: list all pages
 * - useAdminWebPage: single page detail with canvas data
 * - useUpsertWebPage: create/update page metadata
 * - useUpdateWebPageCanvas: save GrapeJS canvas data
 * - useDeleteWebPage: soft-delete a page
 *
 * @module
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { parseRpcArray } from "@/lib/validation/rpcSchemas";
import {
  webPageAdminDetailSchema,
  webPageAdminListSchema,
  brandingSiteAdminSchema,
} from "@/lib/schemas/webPageSchemas";
import { useSession } from "@/hooks/useSession";
import { safeError } from "@/lib/security/safeLogger";

import type {
  WebPageAdminDetail,
  WebPageAdminList,
  BrandingSiteAdmin,
} from "@/lib/schemas/webPageSchemas";
import type { Json } from "@/integrations/db/types";

// =====================================================
// Query hooks
// =====================================================

/**
 * Fetches all active web pages for the admin list.
 *
 * @param brandingProfileId - Optional brand/site filter. Pass a branding
 *   profile id to list only that site's pages, or omit/`null` for all pages.
 * @returns Query result with array of admin page list items
 */
export function useAdminWebPages(brandingProfileId?: string | null) {
  const { user } = useSession();

  const query = useQuery<WebPageAdminList[]>({
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_web_pages_admin", {
        p_branding_profile_id: brandingProfileId ?? undefined,
      });
      if (error) throw new Error(error.message);
      return parseRpcArray(
        webPageAdminListSchema,
        data,
        "get_web_pages_admin"
      ) as WebPageAdminList[];
    },
    queryKey: ["admin-web-pages", brandingProfileId ?? null],
  });

  return {
    ...query,
    pages: query.data ?? [],
  };
}

/**
 * Fetches a single web page by ID with full canvas data for editing.
 *
 * @param id - The UUID of the web page to fetch
 * @returns Query result with admin page detail or null
 */
export function useAdminWebPage(id: string | undefined) {
  const { user } = useSession();

  return useQuery<WebPageAdminDetail | null>({
    enabled: !!user && !!id,
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_web_page_admin", {
        p_id: id!,
      });
      if (error) throw new Error(error.message);
      const rows = parseRpcArray(
        webPageAdminDetailSchema,
        data,
        "get_web_page_admin"
      ) as WebPageAdminDetail[];
      return rows[0] ?? null;
    },
    queryKey: ["admin-web-page", id],
  });
}

/**
 * Fetches the platform brand "sites" available for page assignment/filtering.
 *
 * Each entry pairs a branding profile with the hostnames routed to it, so the
 * admin page builder can present a "which site?" selector.
 *
 * @returns Query result with array of brand sites
 */
export function useBrandingSites() {
  const { user } = useSession();

  const query = useQuery<BrandingSiteAdmin[]>({
    enabled: !!user,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_branding_sites_admin");
      if (error) throw new Error(error.message);
      return parseRpcArray(
        brandingSiteAdminSchema,
        data,
        "get_branding_sites_admin"
      ) as BrandingSiteAdmin[];
    },
    queryKey: ["admin-branding-sites"],
  });

  return {
    ...query,
    sites: query.data ?? [],
  };
}

// =====================================================
// Mutation hooks
// =====================================================

/** Input for creating/updating web page metadata */
export interface UpsertWebPageInput {
  branding_profile_id?: string | null;
  description_key?: string;
  id?: string;
  og_image_url?: string;
  slug?: string;
  sort_order?: number;
  status?: string;
  title_key?: string;
}

/**
 * Creates or updates web page metadata (not canvas).
 *
 * @returns Mutation that resolves to the page UUID
 */
export function useUpsertWebPage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpsertWebPageInput) => {
      const { data, error } = await aisha.rpc("upsert_web_page_admin", {
        p_branding_profile_id: input.branding_profile_id ?? undefined,
        p_description_key: input.description_key ?? undefined,
        p_id: input.id ?? undefined,
        p_og_image_url: input.og_image_url ?? undefined,
        p_slug: input.slug ?? undefined,
        p_sort_order: input.sort_order ?? 0,
        p_status: input.status ?? "draft",
        p_title_key: input.title_key ?? undefined,
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onError: (error) => {
      safeError("admin.web_page.upsert.failed", error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-web-pages"] });
    },
  });
}

/** Input for saving GrapeJS canvas data */
export interface UpdateWebPageCanvasInput {
  canvas_css?: string | null;
  canvas_data?: unknown;
  canvas_html?: string | null;
  id: string;
  page_settings?: Record<string, unknown> | null;
  publish?: boolean;
}

/**
 * Saves GrapeJS canvas data for a web page.
 *
 * @returns Mutation for saving canvas data
 */
export function useUpdateWebPageCanvas() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateWebPageCanvasInput) => {
      const { error } = await aisha.rpc("update_web_page_canvas_admin", {
        p_canvas_css: input.canvas_css ?? undefined,
        p_canvas_data: (input.canvas_data as Json) ?? null,
        p_canvas_html: input.canvas_html ?? undefined,
        p_id: input.id,
        p_page_settings: (input.page_settings as unknown as Json) ?? undefined,
        p_publish: input.publish ?? false,
      });
      if (error) throw new Error(error.message);
    },
    onError: (error) => {
      safeError("admin.web_page.canvas.save.failed", error);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin-web-page", variables.id] });
      queryClient.invalidateQueries({ queryKey: ["admin-web-pages"] });
      queryClient.invalidateQueries({ queryKey: ["web-page"] });
    },
  });
}

/**
 * Soft-deletes a web page.
 *
 * @returns Mutation for deleting a page
 */
export function useDeleteWebPage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await aisha.rpc("delete_web_page_admin", {
        p_id: id,
      });
      if (error) throw new Error(error.message);
    },
    onError: (error) => {
      safeError("admin.web_page.delete.failed", error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-web-pages"] });
    },
  });
}
