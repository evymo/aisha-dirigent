/**
 * useStoryKnowledgeItems — Phase 8 per-story knowledge_items hooks.
 *
 * Complements `useStoryKnowledge` (which handles Ragnarok file upload via
 * the kb_id=`story-{storyId}` namespace). This hook is for direct, manually
 * curated knowledge_items rows scoped to a story — markdown body, tags,
 * category, visibility — what the user means by "structure + tag".
 *
 * Three surfaces:
 *   useStoryKnowledgeItems — live list (knowledge_items table)
 *   useUpsertStoryKnowledgeItem — admin/staff create or update
 *   useDeleteStoryKnowledgeItem — admin/staff soft-delete (status='archived')
 *
 * Each mutation is audited server-side; UI gates buttons via usePermissions().
 *
 * @module hooks/useStoryKnowledgeItems
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { useLiveTable } from "@/hooks/useLiveTable";

// ============================================================================
// Schema
// ============================================================================

const StoryKbItemSchema = z.object({
  id: z.string().uuid(),
  item_type: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  category: z.string().nullable(),
  ai_context_tags: z.array(z.string()),
  status: z.string(),
  visibility: z.string(),
  version: z.number().int(),
  author_display_name: z.string().nullable(),
  is_verified: z.boolean(),
  quarantine_status: z.string(),
  safety_score: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const StoryKbArraySchema = z.array(StoryKbItemSchema);

export type StoryKnowledgeItem = z.infer<typeof StoryKbItemSchema>;

// ============================================================================
// List (live)
// ============================================================================

interface UseStoryKnowledgeItemsOptions {
  storyId: string | null | undefined;
  includeArchived?: boolean;
  enabled?: boolean;
}

export function useStoryKnowledgeItems(opts: UseStoryKnowledgeItemsOptions) {
  const { storyId, includeArchived = false, enabled = true } = opts;
  return useLiveTable<StoryKnowledgeItem>({
    table: "knowledge_items",
    queryKey: ["story_knowledge_items", storyId, includeArchived],
    enabled: enabled && !!storyId,
    rpc: async () => {
      if (!storyId) return [];
      const { data, error } = await aisha.rpc("list_story_knowledge_items", {
        p_include_archived: includeArchived,
        p_story_id: storyId,
      });
      if (error) {
        safeError("useStoryKnowledgeItems", error);
        throw error;
      }
      return StoryKbArraySchema.parse(data ?? []);
    },
  });
}

// ============================================================================
// Upsert (admin-only)
// ============================================================================

export interface UpsertStoryKnowledgeInput {
  storyId: string;
  id?: string | null;
  title?: string;
  bodyMarkdown?: string;
  itemType?: string;
  summary?: string | null;
  category?: string | null;
  tags?: string[];
  aiInstructions?: string | null;
  visibility?: string;
}

export function useUpsertStoryKnowledgeItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertStoryKnowledgeInput) => {
      const { data, error } = await aisha.rpc(
        "upsert_story_knowledge_item_audited",
        {
          p_ai_context_tags: input.tags ?? [],
          p_ai_instructions: input.aiInstructions ?? undefined,
          p_body_markdown: input.bodyMarkdown ?? undefined,
          p_category: input.category ?? undefined,
          p_id: input.id ?? undefined,
          p_item_type: input.itemType ?? "engineering_doc",
          p_story_id: input.storyId,
          p_summary: input.summary ?? undefined,
          p_title: input.title ?? undefined,
          p_visibility: input.visibility ?? "public",
        },
      );
      if (error) {
        safeError("useUpsertStoryKnowledgeItem", error);
        throw error;
      }
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["story_knowledge_items"] });
    },
  });
}

// ============================================================================
// Delete (soft)
// ============================================================================

interface DeleteStoryKnowledgeInput {
  id: string;
  reason?: string | null;
}

export function useDeleteStoryKnowledgeItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DeleteStoryKnowledgeInput) => {
      const { data, error } = await aisha.rpc(
        "delete_story_knowledge_item_audited",
        {
          p_id: input.id,
          p_reason: input.reason ?? undefined,
        },
      );
      if (error) {
        safeError("useDeleteStoryKnowledgeItem", error);
        throw error;
      }
      return data as boolean;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["story_knowledge_items"] });
    },
  });
}
