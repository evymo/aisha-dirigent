import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { z } from "zod";
import {
  contributionWithStudyArraySchema,
  studyWithFundingGoalArraySchema,
  studyContributionRowArraySchema,
  parseArrayResponse,
  studyWithFundingGoalSchema,
  studyContributionRowSchema,
} from "@/lib/schemas/adminSchemas";
import { safeError } from "@/lib/security/safeLogger";
import { usePermissions } from "./usePermissions";
import { useAdminGuard } from "./useAdminGuard";

type ContributionWithStudy = z.infer<typeof contributionWithStudyArraySchema>[number];
type StudyWithFundingGoal = z.infer<typeof studyWithFundingGoalSchema>;
type StudyContributionRow = z.infer<typeof studyContributionRowSchema>;

/**
 * Study with dynamic funding calculated from contributions.
 */
export interface StudyWithDynamicFunding extends StudyWithFundingGoal {
  dynamic_funding: number;
}

/**
 * Hook to fetch all study contributions for admin.
 *
 * @returns Query result containing contributions with study details
 *
 * @example
 * const { data: contributions, isLoading } = useStudyContributionsAdmin();
 */
export function useStudyContributionsAdmin() {
  const { hasPermission } = usePermissions();
  const canViewAdminDashboard = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["admin-contributions"],
    queryFn: async (): Promise<ContributionWithStudy[]> => {
      if (!canViewAdminDashboard) return [];
      const { data, error } = await aisha.rpc("get_study_contributions_admin");
      if (error) {
        safeError("useStudyContributionsAdmin.error", error);
        throw new Error(error.message);
      }
      return parseArrayResponse(contributionWithStudyArraySchema, data, "adminContributions");
    },
    enabled: canViewAdminDashboard,
  });
}

/**
 * Hook to fetch studies with funding goals and dynamic funding calculations.
 *
 * @returns Query result containing studies with funding data
 *
 * @example
 * const { data: studiesWithFunding } = useStudiesWithDynamicFunding();
 */
export function useStudiesWithDynamicFunding() {
  const { hasPermission } = usePermissions();
  const canViewAdminDashboard = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["admin-studies-with-dynamic-funding"],
    queryFn: async (): Promise<StudyWithDynamicFunding[]> => {
      if (!canViewAdminDashboard) return [];
      // Fetch studies with funding goals
      const { data: studiesData, error: studiesError } = await aisha.rpc(
        "get_studies_funding_goals_admin"
      );
      if (studiesError) {
        safeError("useStudiesWithDynamicFunding.studiesError", studiesError);
        throw studiesError;
      }

      const validatedStudies = parseArrayResponse(
        studyWithFundingGoalArraySchema,
        studiesData,
        "studiesWithFunding"
      );

      // Fetch completed contributions
      const { data: contributionsData, error: contributionsError } = await aisha.rpc(
        "get_completed_study_contributions_admin"
      );
      if (contributionsError) {
        safeError("useStudiesWithDynamicFunding.contributionsError", contributionsError);
        throw contributionsError;
      }

      const validatedContributions = parseArrayResponse(
        studyContributionRowArraySchema,
        contributionsData,
        "completedContributions"
      );

      // Calculate dynamic funding per study
      const fundingByStudy = new Map<string, number>();
      validatedContributions.forEach((c: StudyContributionRow) => {
        const current = fundingByStudy.get(c.study_id) || 0;
        fundingByStudy.set(c.study_id, current + Number(c.amount));
      });

      return validatedStudies.map((study) => ({
        ...study,
        dynamic_funding: fundingByStudy.get(study.id) || 0,
      }));
    },
    enabled: canViewAdminDashboard,
  });
}

/**
 * Hook to update study contribution status.
 *
 * @returns Mutation for updating contribution status
 *
 * @example
 * const updateStatus = useUpdateStudyContributionStatus();
 * await updateStatus.mutateAsync({ id: 'abc123', status: 'completed' });
 */
export function useUpdateStudyContributionStatus() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation(
      "update_study_contribution_status_admin",
      async ({
        id,
        status,
      }: {
        id: string;
        status: string;
      }) => {
      const { error } = await aisha.rpc("update_study_contribution_status_admin", {
        p_id: id,
        p_status: status,
      });
      if (error) {
        safeError("useUpdateStudyContributionStatus.error", error);
        throw new Error(error.message);
      }
      }
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-contributions"] });
      queryClient.invalidateQueries({ queryKey: ["admin-studies-with-dynamic-funding"] });
    },
  });
}
