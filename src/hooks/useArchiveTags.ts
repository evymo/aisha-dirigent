/**
 * useArchiveTags
 * Hook for managing archive tags with translation support
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useAdminGuard } from "@/hooks/useAdminGuard";
import { z } from "zod";

// Tag categories
export const ARCHIVE_TAG_CATEGORIES = ["person", "keyword", "preparation", "facility", "place"] as const;
export type ArchiveTagCategory = typeof ARCHIVE_TAG_CATEGORIES[number];

// Zod schema for validation
const archiveTagSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  category: z.string(),
  name_key: z.string(),
  display_name: z.string(),
  sort_order: z.number(),
  is_active: z.boolean(),
  usage_count: z.number(),
});

export type ArchiveTag = z.infer<typeof archiveTagSchema>;

/**
 * Fetch all archive tags, optionally filtered by category
 */
export function useArchiveTags(category?: ArchiveTagCategory, activeOnly = true) {
  return useQuery({
    queryKey: ["archive-tags", category, activeOnly],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_archive_tags", {
        p_active_only: activeOnly,
        p_category: category ?? undefined,
      });

      if (error) throw new Error(error.message);

      const parsed = z.array(archiveTagSchema).safeParse(data);
      return parsed.success ? parsed.data : [];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Get tags grouped by category
 */
export function useArchiveTagsByCategory(activeOnly = true) {
  const { data: tags, ...query } = useArchiveTags(undefined, activeOnly);

  const tagsByCategory = tags?.reduce((acc, tag) => {
    const cat = tag.category as ArchiveTagCategory;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(tag);
    return acc;
  }, {} as Record<ArchiveTagCategory, ArchiveTag[]>);

  return {
    ...query,
    tags,
    tagsByCategory,
  };
}

/**
 * Create a new archive tag
 */
export function useCreateArchiveTag() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("create_archive_tag_admin", async (input: {
      code: string;
      category: ArchiveTagCategory;
      display_name: string;
      name_key?: string;
      sort_order?: number;
      is_active?: boolean;
    }) => {
      const { data, error } = await aisha.rpc("create_archive_tag_admin", {
        p_category: input.category,
        p_code: input.code,
        p_display_name: input.display_name,
        p_is_active: input.is_active ?? true,
        p_name_key: input.name_key ?? undefined,
        p_sort_order: input.sort_order ?? 0,
      });

      if (error) throw new Error(error.message);
      return data as string; // Returns UUID
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["archive-tags"] });
    },
  });
}

/**
 * Update an existing archive tag
 */
export function useUpdateArchiveTag() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("update_archive_tag_admin", async (input: {
      id: string;
      code?: string;
      display_name?: string;
      name_key?: string;
      sort_order?: number;
      is_active?: boolean;
    }) => {
      const { data, error } = await aisha.rpc("update_archive_tag_admin", {
        p_code: input.code ?? undefined,
        p_display_name: input.display_name ?? undefined,
        p_id: input.id,
        p_is_active: input.is_active ?? undefined,
        p_name_key: input.name_key ?? undefined,
        p_sort_order: input.sort_order ?? undefined,
      });

      if (error) throw new Error(error.message);
      return data;
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["archive-tags"] });
    },
  });
}

/**
 * Delete an archive tag
 */
export function useDeleteArchiveTag() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("delete_archive_tag_admin", async (id: string) => {
      const { data, error } = await aisha.rpc("delete_archive_tag_admin", {
        p_id: id,
      });

      if (error) throw new Error(error.message);
      return data;
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["archive-tags"] });
    },
  });
}
