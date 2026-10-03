/**
 * Projects hook — fetches project/story list for dashboard.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/config/api";
import { projectSummarySchema } from "@/types/schemas";
import { safeError } from "@/lib/security/safeLogger";

import type { ProjectSummary } from "@/types/schemas";

function parseProjectArray(data: unknown): ProjectSummary[] {
  if (!Array.isArray(data)) return [];
  return data.reduce<ProjectSummary[]>((acc, item) => {
    const result = projectSummarySchema.safeParse(item);
    if (result.success) acc.push(result.data);
    return acc;
  }, []);
}

export function useProjects(userId: string | undefined) {
  return useQuery({
    queryKey: ["projects", userId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_my_stories_audited", {});
      if (error) {
        safeError("useProjects.fetch", error);
        throw error;
      }
      return parseProjectArray(data);
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useProjectDetail(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-detail", projectId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_story_detail_audited", {
        p_story_id: projectId!,
      });
      if (error) {
        safeError("useProjectDetail.fetch", error);
        throw error;
      }
      return data;
    },
    enabled: !!projectId,
    staleTime: 2 * 60 * 1000,
  });
}
