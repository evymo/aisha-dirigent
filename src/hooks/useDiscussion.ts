/**
 * Hooks for the generic "discussion under any content node" surface.
 *
 * Reads via get_discussion_entries (threaded), posts via
 * create_discussion_entry_audited, and lists post types via get_entry_types —
 * the polymorphic story_entries primitive + the template-driven entry-type
 * registry. Used by DiscussionThreadBlock (a GrapesJS runtime block).
 *
 * @module
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { parseRpcArrayResponse } from "@/schemas/rpcResponseSchemas";

export const DiscussionEntrySchema = z.object({
  id: z.string(),
  parent_id: z.string().nullable(),
  entry_type: z.string(),
  content: z.string(),
  metadata: z.record(z.unknown()).nullable().optional(),
  created_by: z.string().nullable(),
  created_at: z.string(),
});
export type DiscussionEntry = z.infer<typeof DiscussionEntrySchema>;

export const EntryTypeSchema = z.object({
  entry_type: z.string(),
  name_key: z.string(),
  description_key: z.string().nullable().optional(),
  metadata_schema: z.record(z.unknown()).nullable().optional(),
  render_block: z.string().nullable().optional(),
  sort_order: z.number(),
});
export type EntryType = z.infer<typeof EntryTypeSchema>;

/** Read the (visible) discussion thread under a public content node. */
export function useDiscussionEntries(subjectType: string, subjectId: string, limit = 100) {
  const query = useQuery({
    queryKey: ["discussion", subjectType, subjectId, limit] as const,
    enabled: Boolean(subjectType && subjectId),
    staleTime: 60_000, // client-side dedup; public reads change rarely (see 2c caching)
    queryFn: async (): Promise<DiscussionEntry[]> => {
      const { data, error } = await aisha.rpc("get_discussion_entries", {
        p_limit: limit,
        p_offset: 0,
        p_subject_id: subjectId,
        p_subject_type: subjectType,
      });
      if (error) {
        safeError("discussion.fetch", error);
        throw new Error(error.message);
      }
      return parseRpcArrayResponse(DiscussionEntrySchema, data);
    },
  });
  return { entries: query.data ?? [], isLoading: query.isLoading, error: query.error };
}

/** The post types available for this subject (template-driven registry). */
export function useEntryTypes(subjectType: string) {
  const query = useQuery({
    queryKey: ["entry-types", subjectType] as const,
    enabled: Boolean(subjectType),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<EntryType[]> => {
      const { data, error } = await aisha.rpc("get_entry_types", { p_subject_type: subjectType });
      if (error) {
        safeError("entry-types.fetch", error);
        throw new Error(error.message);
      }
      return parseRpcArrayResponse(EntryTypeSchema, data);
    },
  });
  return { types: query.data ?? [], isLoading: query.isLoading };
}

/** Post a discussion entry (top-level or threaded reply). */
export function usePostDiscussion(subjectType: string, subjectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { content: string; entryType?: string; parentId?: string | null }) => {
      const { data, error } = await aisha.rpc("create_discussion_entry_audited", {
        p_content: input.content,
        p_entry_type: input.entryType ?? "comment",
        p_parent_id: input.parentId ?? undefined,
        p_subject_id: subjectId,
        p_subject_type: subjectType,
      });
      if (error) {
        safeError("discussion.post", error);
        throw new Error(error.message);
      }
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["discussion", subjectType, subjectId] });
    },
  });
}
