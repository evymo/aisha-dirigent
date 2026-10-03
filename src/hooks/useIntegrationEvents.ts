/**
 * Hook for integration event observability.
 *
 * Provides queries for event stats (dashboard), event timeline per story,
 * and AISHA maturity scoring.
 *
 * @module hooks/useIntegrationEvents
 */

import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { usePermissions } from "./usePermissions";
import { safeError } from "@/lib/security/safeLogger";
import {
  integrationEventStatsSchema,
  integrationEventArraySchema,
  aishaMaturitySchema,
} from "@/lib/schemas/githubSchemas";

import type {
  IntegrationEventStats,
  IntegrationEvent,
  AishaMaturity,
} from "@/lib/schemas/githubSchemas";

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const integrationEventKeys = {
  all: ["integration-events"] as const,
  stats: (hoursBack: number, eventSource?: string) =>
    [...integrationEventKeys.all, "stats", hoursBack, eventSource] as const,
  story: (storyId: string) =>
    [...integrationEventKeys.all, "story", storyId] as const,
  maturity: (storyId: string) =>
    [...integrationEventKeys.all, "maturity", storyId] as const,
};

// ---------------------------------------------------------------------------
// GET: Integration event stats (dashboard)
// ---------------------------------------------------------------------------

/**
 * Fetch aggregated integration event statistics.
 *
 * Returns total/completed/failed/exhausted counts, avg/p95 duration,
 * error rate, top errors, and per-event-type breakdown.
 *
 * Requires admin or staff permission.
 */
export function useIntegrationEventStats(
  hoursBack = 24,
  eventSource?: string,
) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: integrationEventKeys.stats(hoursBack, eventSource),
    queryFn: async (): Promise<IntegrationEventStats | null> => {
      const { data, error } = await aisha.rpc("get_integration_event_stats", {
        p_event_source: eventSource ?? undefined,
        p_hours_back: hoursBack,
      });

      if (error) {
        safeError("integration.stats.fetch", error);
        throw new Error(error.message);
      }

      const parsed = integrationEventStatsSchema.safeParse(data);
      if (!parsed.success) {
        safeError("integration.stats.validation", parsed.error);
        return null;
      }
      return parsed.data;
    },
    enabled: canView,
    staleTime: 60 * 1000, // 1 min — stats refresh frequently
  });
}

// ---------------------------------------------------------------------------
// GET: Integration events for a story (timeline)
// ---------------------------------------------------------------------------

/**
 * Fetch integration event timeline for a specific story.
 *
 * Returns recent events with status, duration, routing info.
 *
 * Requires admin or staff permission.
 */
export function useIntegrationEventsForStory(
  storyId: string | undefined,
  limit = 50,
) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: integrationEventKeys.story(storyId ?? ""),
    queryFn: async (): Promise<IntegrationEvent[]> => {
      if (!storyId) return [];

      const { data, error } = await aisha.rpc("get_integration_events_for_story", {
        p_limit: limit,
        p_story_id: storyId,
      });

      if (error) {
        safeError("integration.storyEvents.fetch", error);
        throw new Error(error.message);
      }

      const parsed = integrationEventArraySchema.safeParse(data);
      if (!parsed.success) {
        safeError("integration.storyEvents.validation", parsed.error);
        return [];
      }
      return parsed.data;
    },
    enabled: canView && !!storyId,
    staleTime: 30 * 1000, // 30s — timeline updates with new events
  });
}

// ---------------------------------------------------------------------------
// GET: AISHA maturity score for story
// ---------------------------------------------------------------------------

/**
 * Fetch AISHA maturity score for a story.
 *
 * Returns webhook reliability, response time, deploy success rate,
 * compliance pass rate, learning proposals count, and overall maturity level.
 *
 * Requires admin or staff permission.
 */
export function useStoryAishaMaturity(storyId: string | undefined) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: integrationEventKeys.maturity(storyId ?? ""),
    queryFn: async (): Promise<AishaMaturity | null> => {
      if (!storyId) return null;

      const { data, error } = await aisha.rpc("get_story_aisha_maturity", {
        p_story_id: storyId,
      });

      if (error) {
        safeError("integration.maturity.fetch", error);
        throw new Error(error.message);
      }

      const parsed = aishaMaturitySchema.safeParse(data);
      if (!parsed.success) {
        safeError("integration.maturity.validation", parsed.error);
        return null;
      }
      return parsed.data;
    },
    enabled: canView && !!storyId,
    staleTime: 5 * 60 * 1000, // 5 min — maturity doesn't change fast
  });
}
