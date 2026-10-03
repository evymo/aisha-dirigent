/**
 * useStoryBranchDeployRail — flat per-app rail snapshot for the
 * BranchDeployRail UI. Subscribes to coolify_app_slots for live B/G
 * switch updates.
 *
 * @module hooks/useStoryBranchDeployRail
 */

import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { useLiveTable } from "@/hooks/useLiveTable";

const RailRowSchema = z.object({
  app_name: z.string(),
  active_slot: z.string(),
  active_image_tag: z.string().nullable(),
  inactive_image_tag: z.string().nullable(),
  active_health: z.string().nullable(),
  last_switch_at: z.string().nullable(),
  default_branch: z.string().nullable(),
  last_rollback_at: z.string().nullable(),
  last_rollback_status: z.string().nullable(),
});

const RailArraySchema = z.array(RailRowSchema);

export type BranchDeployRailRow = z.infer<typeof RailRowSchema>;

interface UseStoryBranchDeployRailOptions {
  storyId: string | null | undefined;
  enabled?: boolean;
}

export function useStoryBranchDeployRail(opts: UseStoryBranchDeployRailOptions) {
  const { storyId, enabled = true } = opts;

  return useLiveTable<BranchDeployRailRow>({
    table: "coolify_app_slots",
    queryKey: ["story_branch_deploy_rail", storyId],
    enabled: enabled && !!storyId,
    rpc: async () => {
      if (!storyId) return [];
      const { data, error } = await aisha.rpc("story_branch_deploy_rail", {
        p_story_id: storyId,
      });
      if (error) {
        safeError("useStoryBranchDeployRail", error);
        throw error;
      }
      return RailArraySchema.parse(data ?? []);
    },
  });
}
