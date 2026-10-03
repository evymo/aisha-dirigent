import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { usePermissions } from "@/hooks/usePermissions";
import {
  AdminStoryLoopOverviewSchema,
  type AdminStoryLoopOverview,
} from "@/schemas/storyLoopSchemas";

const EMPTY_ADMIN_STORYLOOP_OVERVIEW: AdminStoryLoopOverview = {
  total_stories: 0,
  active_stories: 0,
  stories_active_7d: 0,
  stories_active_30d: 0,
  inbox_count: 0,
  in_progress_count: 0,
  scheduled_count: 0,
  archived_count: 0,
  trash_count: 0,
  starred_count: 0,
  unread_total: 0,
  total_entries: 0,
  entries_7d: 0,
  entries_30d: 0,
  reminders_upcoming_7d: 0,
  reminders_overdue: 0,
  partners_active: 0,
  members_covered: 0,
};

/**
 * Fetch non-sensitive StoryLoop aggregates for admin/staff monitoring.
 *
 * Data source: `public.get_storyloop_admin_overview()`
 */
export function useAdminStoryLoopOverview() {
  const { hasPermission } = usePermissions();
  const canViewAdmin = hasPermission("view_admin_dashboard") || hasPermission("view_staff_dashboard");

  return useQuery({
    queryKey: ["admin", "storyloop", "overview"],
    enabled: canViewAdmin,
    staleTime: 60_000,
    queryFn: async (): Promise<AdminStoryLoopOverview> => {
      const { data, error } = await aisha.rpc("get_storyloop_admin_overview");
      if (error) {
        safeError("storyloop.admin.overview", error);
        throw new Error(error.message);
      }

      const row = Array.isArray(data) ? data[0] : data;
      const validated = AdminStoryLoopOverviewSchema.safeParse(row);
      if (!validated.success) {
        safeError("storyloop.admin.overview.validation", validated.error);
        return EMPTY_ADMIN_STORYLOOP_OVERVIEW;
      }

      return validated.data;
    },
  });
}
