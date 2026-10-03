/**
 * Hooks for page version management (snapshot / restore).
 *
 * Provides:
 * - `usePageVersions` — query version list for a page
 * - `useCreatePageVersion` — snapshot current page state
 * - `useRestorePageVersion` — restore page from a version
 *
 * @module
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { z } from "zod";
import { safeError } from "@/lib/security/safeLogger";

/** Zod schema for a page version list entry. */
const pageVersionSchema = z.object({
  created_at: z.string(),
  created_by: z.string().uuid().nullable(),
  id: z.string().uuid(),
  label: z.string().nullable(),
  version_number: z.number(),
});

/** Type of a page version list entry. */
export type PageVersion = z.infer<typeof pageVersionSchema>;

/**
 * Fetch version list for a given page.
 *
 * @param pageId - UUID of the web_page
 */
export function usePageVersions(pageId: string | undefined) {
  return useQuery({
    enabled: !!pageId,
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_web_page_versions", {
        p_page_id: pageId!,
      });
      if (error) throw new Error(error.message);
      const rows = Array.isArray(data) ? data : [];
      return rows.map((r) => pageVersionSchema.parse(r));
    },
    queryKey: ["web-page-versions", pageId],
    staleTime: 60_000,
  });
}

/**
 * Create a version snapshot for a page.
 */
export function useCreatePageVersion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      label,
      pageId,
    }: {
      label?: string;
      pageId: string;
    }) => {
      const { data, error } = await aisha.rpc("create_web_page_version", {
        p_label: label ?? undefined,
        p_page_id: pageId,
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onError: (err) => safeError("createPageVersion.failed", err),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({
        queryKey: ["web-page-versions", vars.pageId],
      });
    },
  });
}

/**
 * Restore a page from a previous version.
 */
export function useRestorePageVersion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      pageId,
      versionId,
    }: {
      pageId: string;
      versionId: string;
    }) => {
      const { error } = await aisha.rpc("restore_web_page_version", {
        p_page_id: pageId,
        p_version_id: versionId,
      });
      if (error) throw new Error(error.message);
    },
    onError: (err) => safeError("restorePageVersion.failed", err),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({
        queryKey: ["web-page-versions", vars.pageId],
      });
      queryClient.invalidateQueries({
        queryKey: ["admin-web-page", vars.pageId],
      });
    },
  });
}
