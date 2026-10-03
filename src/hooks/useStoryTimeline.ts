/**
 * useStoryTimeline — chronological feed of what AISHA + the deploy pipeline
 * have done for one story. Subscribes to ai_trace_events for live updates.
 *
 * @module hooks/useStoryTimeline
 */

import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { useLiveTable } from "@/hooks/useLiveTable";

const TimelineEventSchema = z.object({
  event_id: z.string().uuid(),
  event_kind: z.string(),
  trace_event_type: z.string().nullable(),
  ts: z.string(),
  agent_slug: z.string().nullable(),
  operation: z.string().nullable(),
  status: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  cost: z.number().nullable(),
  story_id: z.string().uuid(),
  run_id: z.string().uuid().nullable(),
  app_name: z.string().nullable(),
  files_changed: z.array(z.string()).nullable(),
  payload: z.unknown(),
});

const TimelineArraySchema = z.array(TimelineEventSchema);

export type StoryTimelineEvent = z.infer<typeof TimelineEventSchema>;

interface UseStoryTimelineOptions {
  storyId: string | null | undefined;
  limit?: number;
  enabled?: boolean;
}

export function useStoryTimeline(opts: UseStoryTimelineOptions) {
  const { storyId, limit = 50, enabled = true } = opts;

  return useLiveTable<StoryTimelineEvent>({
    table: "ai_trace_events",
    queryKey: ["story_timeline", storyId, limit],
    enabled: enabled && !!storyId,
    rpc: async () => {
      if (!storyId) return [];
      const { data, error } = await aisha.rpc("story_timeline", {
        p_limit: limit,
        p_story_id: storyId,
      });
      if (error) {
        safeError("useStoryTimeline", error);
        throw error;
      }
      return TimelineArraySchema.parse(data ?? []);
    },
  });
}
