/**
 * useStoryDetail — rich story metadata + entries + labels + reminders.
 *
 * Wraps the `get_story_detail_audited` RPC, which the audit_journal'd
 * canonical accessor for a single story (handles ownership, RLS,
 * audit logging in one place).
 *
 * Used by AdminStoryDetail page (and any other surface that needs the
 * full story payload — diff timeline, mission control story drill-in).
 *
 * @module hooks/useStoryDetail
 */

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";

// ============================================================================
// Schema
// ============================================================================

// labels / entries / reminders come back as JSONB — keep them as raw json
// arrays here; per-tab UIs apply their own narrower schemas where needed.
const JsonArraySchema = z.array(z.unknown());

const StoryDetailSchema = z.object({
  id: z.string().uuid(),
  partner_id: z.string().uuid().nullable(),
  user_id: z.string().uuid().nullable(),
  study_id: z.string().uuid().nullable(),
  title: z.string(),
  status: z.string(),
  priority: z.string(),
  is_starred: z.boolean(),
  is_read: z.boolean(),
  unread_count: z.number().int(),
  last_activity_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  user_display_name: z.string().nullable(),
  study_name: z.string().nullable(),
  labels: JsonArraySchema.default([]),
  entries: JsonArraySchema.default([]),
  reminders: JsonArraySchema.default([]),
});

const StoryDetailArraySchema = z.array(StoryDetailSchema);

/** Rich story payload returned by get_story_detail_audited. */
export type StoryDetail = z.infer<typeof StoryDetailSchema>;

// ============================================================================
// Hook
// ============================================================================

interface UseStoryDetailOptions {
  /** Story to load. */
  storyId: string | null | undefined;
  /** Disable the query (e.g. while storyId resolves). */
  enabled?: boolean;
}

/**
 * Fetches rich detail for a single story (single row from
 * `get_story_detail_audited`).
 *
 * The RPC is audit-logged on every call; staleTime is 30s so the audit
 * trail accurately reflects user views.
 */
export function useStoryDetail(opts: UseStoryDetailOptions) {
  const { storyId, enabled = true } = opts;

  return useQuery({
    queryKey: ["story_detail", storyId],
    enabled: enabled && !!storyId,
    staleTime: 30 * 1000,
    queryFn: async (): Promise<StoryDetail | null> => {
      if (!storyId) return null;
      const { data, error } = await aisha.rpc("get_story_detail_audited", {
        p_story_id: storyId,
      });

      if (error) {
        safeError("useStoryDetail", error);
        throw error;
      }

      // The RPC returns a single row inside a 1-element array.
      const rows = StoryDetailArraySchema.parse(data ?? []);
      return rows[0] ?? null;
    },
  });
}
