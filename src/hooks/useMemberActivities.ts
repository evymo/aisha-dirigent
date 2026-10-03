/**
 * Hook for fetching member activity timeline
 * 
 * Aggregates activities from health check-ins, token transactions,
 * study registrations, dosing logs, and document uploads.
 */

import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { z } from "zod";
import { safeError } from "@/lib/security/safeLogger";
import { useSession } from "./useSession";

// Schema for activity timeline item
export const activityTimelineSchema = z.object({
  id: z.string().uuid(),
  activity_type: z.string(),
  title: z.string(),
  description: z.string(),
  token_reward_type: z.string(),
  token_reward_amount: z.number(),
  created_at: z.string(),
});

export type ActivityTimelineItem = z.infer<typeof activityTimelineSchema>;

export type ActivityFilter = "all" | "health" | "tokens" | "documents" | "studies";

/**
 * Fetch member's activity timeline with optional filtering
 */
export function useMemberActivityTimeline(limit: number = 50) {
  const { user } = useSession();

  return useQuery({
    queryKey: ["member-activity-timeline", user?.id, limit],
    queryFn: async (): Promise<ActivityTimelineItem[]> => {
      const { data, error } = await aisha.rpc("get_my_activity_timeline", {
        p_limit: limit,
      });

      if (error) {
        safeError("useMemberActivityTimeline.fetch", error);
        throw new Error(error.message);
      }

      const parsed = z.array(activityTimelineSchema).safeParse(data);
      if (!parsed.success) {
        safeError("useMemberActivityTimeline.validation", parsed.error);
        return [];
      }

      return parsed.data;
    },
    enabled: Boolean(user),
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}

/**
 * Filter activities by type
 */
export function filterActivities(
  activities: ActivityTimelineItem[],
  filter: ActivityFilter
): ActivityTimelineItem[] {
  if (filter === "all") return activities;

  const filterMap: Record<ActivityFilter, string[]> = {
    all: [],
    health: ["health_checkin"],
    tokens: ["token_earned"],
    documents: ["document_uploaded"],
    studies: ["study_enrolled", "dosing_logged"],
  };

  const allowedTypes = filterMap[filter];
  return activities.filter((a) => allowedTypes.includes(a.activity_type));
}

/**
 * Get icon name for activity type
 */
export function getActivityIcon(activityType: string): string {
  const iconMap: Record<string, string> = {
    health_checkin: "Heart",
    token_earned: "Coins",
    study_enrolled: "GraduationCap",
    dosing_logged: "Pill",
    document_uploaded: "FileText",
  };
  return iconMap[activityType] || "Activity";
}

/**
 * Get activity type label key for i18n
 */
export function getActivityLabelKey(activityType: string): string {
  return `memberActivity.types.${activityType}`;
}
