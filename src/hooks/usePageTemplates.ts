/**
 * Hooks for page template management (save / load / apply).
 *
 * Provides:
 * - `usePageTemplates` — query available templates
 * - `useSavePageAsTemplate` — snapshot a page into a template
 * - `useApplyPageTemplate` — apply a template onto a page
 *
 * @module
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { z } from "zod";
import { safeError } from "@/lib/security/safeLogger";

/** Zod schema for a page template list entry. */
const pageTemplateSchema = z.object({
  created_at: z.string(),
  description: z.string().nullable(),
  id: z.string().uuid(),
  name: z.string(),
  thumbnail_url: z.string().nullable(),
});

/** Type of a page template list entry. */
export type PageTemplate = z.infer<typeof pageTemplateSchema>;

/**
 * Fetch active page templates.
 */
export function usePageTemplates() {
  return useQuery({
    queryFn: async () => {
      const { data, error } = await aisha.rpc(
        "get_web_page_templates"
      );
      if (error) throw new Error(error.message);
      const rows = Array.isArray(data) ? data : [];
      return rows.map((r) => pageTemplateSchema.parse(r));
    },
    queryKey: ["web-page-templates"],
    staleTime: 5 * 60_000,
  });
}

/**
 * Save a page's current canvas state as a reusable template.
 */
export function useSavePageAsTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      description?: string;
      name: string;
      pageId: string;
    }) => {
      const { data, error } = await aisha.rpc("save_web_page_as_template", {
        p_description: params.description ?? undefined,
        p_name: params.name,
        p_page_id: params.pageId,
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onError: (err) => safeError("savePageAsTemplate.failed", err),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["web-page-templates"] });
    },
  });
}

/**
 * Apply a template onto a page (overwrites canvas, auto-snapshots before).
 */
export function useApplyPageTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      pageId: string;
      templateId: string;
    }) => {
      const { error } = await aisha.rpc("apply_web_page_template", {
        p_page_id: params.pageId,
        p_template_id: params.templateId,
      });
      if (error) throw new Error(error.message);
    },
    onError: (err) => safeError("applyPageTemplate.failed", err),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["web-page-templates"] });
      queryClient.invalidateQueries({ queryKey: ["admin-web-page", vars.pageId] });
      queryClient.invalidateQueries({ queryKey: ["web-page-versions", vars.pageId] });
    },
  });
}
