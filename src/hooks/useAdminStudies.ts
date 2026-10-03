import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import {
  consultantWithRelationsArraySchema,
  contributionWithStudyArraySchema,
  parseArrayResponse,
  studyWithDynamicDataArraySchema,
  type ConsultantWithRelations,
  type ContributionWithStudy,
  type StudyWithDynamicData,
} from "@/lib/schemas/adminSchemas";
import { usePermissions } from "./usePermissions";
import { useAdminGuard } from "./useAdminGuard";

export type { StudyWithDynamicData, ConsultantWithRelations, ContributionWithStudy };

export type StudyType = "observational" | "operational_trial" | "community";
export type FundingStatus = "draft" | "funding" | "funded" | "active" | "completed" | "cancelled";

/**
 * Hook for fetching studies overview for admin dashboard.
 *
 * @returns Query result with studies data
 *
 * @example
 * const { data: studies, isLoading } = useAdminStudiesOverview();
 */
export function useAdminStudiesOverview() {
  const { hasPermission } = usePermissions();
  const canViewAdminDashboard = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["admin-studies"],
    queryFn: async (): Promise<StudyWithDynamicData[]> => {
      if (!canViewAdminDashboard) return [];
      const { data, error } = await aisha.rpc("get_studies_overview_admin");
      if (error) {
        safeError("useAdminStudiesOverview.error", error);
        throw new Error(error.message);
      }
      return parseArrayResponse(studyWithDynamicDataArraySchema, data, "adminStudiesOverview");
    },
    enabled: canViewAdminDashboard,
  });
}

/**
 * Hook for fetching consultants for a specific study.
 *
 * @param studyId - The study ID to fetch consultants for
 * @returns Query result with consultants data
 *
 * @example
 * const { data: consultants } = useStudyConsultantsAdmin(studyId);
 */
export function useStudyConsultantsAdmin(studyId: string | null) {
  const { hasPermission } = usePermissions();
  const canViewAdminDashboard = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["admin-study-consultants", studyId],
    queryFn: async (): Promise<ConsultantWithRelations[]> => {
      if (!canViewAdminDashboard || !studyId) return [];
      const { data, error } = await aisha.rpc("get_study_consultants_for_study_admin", {
        p_study_id: studyId,
      });
      if (error) {
        safeError("useStudyConsultantsAdmin.error", error);
        throw new Error(error.message);
      }
      return parseArrayResponse(consultantWithRelationsArraySchema, data, "adminStudyConsultants");
    },
    enabled: canViewAdminDashboard && !!studyId,
  });
}

/**
 * Hook for fetching contributions for a specific study.
 *
 * @param studyId - The study ID to fetch contributions for
 * @returns Query result with contributions data
 *
 * @example
 * const { data: contributions } = useStudyContributionsForStudyAdmin(studyId);
 */
export function useStudyContributionsForStudyAdmin(studyId: string | null) {
  const { hasPermission } = usePermissions();
  const canViewAdminDashboard = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["admin-study-contributions", studyId],
    queryFn: async (): Promise<ContributionWithStudy[]> => {
      if (!canViewAdminDashboard || !studyId) return [];
      const { data, error } = await aisha.rpc("get_study_contributions_for_study_admin", {
        p_study_id: studyId,
      });
      if (error) {
        safeError("useStudyContributionsForStudyAdmin.error", error);
        throw new Error(error.message);
      }
      return parseArrayResponse(contributionWithStudyArraySchema, data, "adminStudyContributions");
    },
    enabled: canViewAdminDashboard && !!studyId,
  });
}

export interface CreateStudyParams {
  code: string;
  description?: string;
  descriptionKey?: string;
  durationWeeks?: number;
  endingAt?: string;
  fundingDeadline?: string;
  fundingGoal: number;
  informedConsentSpecialProvisions?: string;
  informedConsentVersion?: string;
  isActive: boolean;
  isBlinded: boolean;
  isUmbrella: boolean;
  maxParticipants?: number;
  minParticipants: number;
  name: string;
  nameKey: string;
  products?: string[];
  protocolUrl?: string;
  startingAt?: string;
  studyType: StudyType;
  targetCondition?: string;
  targetRegistration?: number;
}

/**
 * Hook for creating a new study.
 *
 * @returns Mutation for creating studies
 *
 * @example
 * const createStudy = useCreateStudyAdmin();
 * await createStudy.mutateAsync(params);
 */
export function useCreateStudyAdmin() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("create_study_admin", async (params: CreateStudyParams) => {
      const { data, error } = await aisha.rpc("create_study_admin", {
        p_code: params.code,
        p_description: params.description,
        p_description_key: params.descriptionKey,
        p_duration_weeks: params.durationWeeks,
        p_ends_at: params.endingAt,
        p_funding_deadline: params.fundingDeadline,
        p_funding_goal: params.fundingGoal,
        p_informed_consent_special_provisions: params.informedConsentSpecialProvisions,
        p_informed_consent_version: params.informedConsentVersion,
        p_is_active: params.isActive,
        p_is_blinded: params.isBlinded,
        p_is_umbrella: params.isUmbrella,
        p_max_participants: params.maxParticipants,
        p_min_participants: params.minParticipants,
        p_name: params.name,
        p_name_key: params.nameKey,
        p_products: params.products,
        p_protocol_url: params.protocolUrl,
        p_starts_at: params.startingAt,
        p_study_type: params.studyType,
        p_target_condition: params.targetCondition,
        p_target_registration: params.targetRegistration,
      });
      if (error) {
        safeError("useCreateStudyAdmin.error", error);
        throw new Error(error.message);
      }
      return data;
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-studies"] });
      queryClient.invalidateQueries({ queryKey: ["translations"] });
    },
  });
}

export interface UpdateStudyParams {
  code: string;
  description?: string;
  descriptionKey?: string;
  durationWeeks?: number;
  endingAt?: string;
  fundingDeadline?: string;
  fundingGoal: number;
  id: string;
  informedConsentSpecialProvisions?: string;
  informedConsentVersion?: string;
  isActive: boolean;
  isBlinded: boolean;
  isUmbrella: boolean;
  maxParticipants?: number;
  minParticipants: number;
  name: string;
  nameKey: string;
  products?: string[];
  protocolUrl?: string;
  startingAt?: string;
  studyType: StudyType;
  targetCondition?: string;
  targetRegistration?: number;
}

/**
 * Hook for updating an existing study.
 *
 * @returns Mutation for updating studies
 *
 * @example
 * const updateStudy = useUpdateStudyAdmin();
 * await updateStudy.mutateAsync(params);
 */
export function useUpdateStudyAdmin() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("update_study_admin", async (params: UpdateStudyParams) => {
      const { error } = await aisha.rpc("update_study_admin", {
        p_code: params.code,
        p_description: params.description,
        p_description_key: params.descriptionKey,
        p_duration_weeks: params.durationWeeks,
        p_ends_at: params.endingAt,
        p_funding_deadline: params.fundingDeadline,
        p_funding_goal: params.fundingGoal,
        p_id: params.id,
        p_informed_consent_special_provisions: params.informedConsentSpecialProvisions,
        p_informed_consent_version: params.informedConsentVersion,
        p_is_active: params.isActive,
        p_is_blinded: params.isBlinded,
        p_is_umbrella: params.isUmbrella,
        p_max_participants: params.maxParticipants,
        p_min_participants: params.minParticipants,
        p_name: params.name,
        p_name_key: params.nameKey,
        p_products: params.products,
        p_protocol_url: params.protocolUrl,
        p_starts_at: params.startingAt,
        p_study_type: params.studyType,
        p_target_condition: params.targetCondition,
        p_target_registration: params.targetRegistration,
      });
      if (error) {
        safeError("useUpdateStudyAdmin.error", error);
        throw new Error(error.message);
      }
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-studies"] });
      queryClient.invalidateQueries({ queryKey: ["translations"] });
    },
  });
}

/**
 * Hook for updating consultant status.
 *
 * @returns Mutation for updating consultant status
 *
 * @example
 * const updateStatus = useUpdateStudyConsultantStatusAdmin();
 * await updateStatus.mutateAsync({ id, status: 'approved' });
 */
export function useUpdateStudyConsultantStatusAdmin() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation(
      "update_study_consultant_status_admin",
      async ({ id, status }: { id: string; status: string }) => {
      const { error } = await aisha.rpc("update_study_consultant_status_admin", {
        p_id: id,
        p_status: status,
      });
      if (error) {
        safeError("useUpdateStudyConsultantStatusAdmin.error", error);
        throw new Error(error.message);
      }
      }
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-study-consultants"] });
    },
  });
}

/**
 * Hook for updating study funding status.
 *
 * @returns Mutation for updating funding status
 *
 * @example
 * const updateStatus = useUpdateStudyFundingStatusAdmin();
 * await updateStatus.mutateAsync({ id, status: 'funded' });
 */
export function useUpdateStudyFundingStatusAdmin() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation(
      "update_study_funding_status_admin",
      async ({ id, status }: { id: string; status: FundingStatus }) => {
      const { error } = await aisha.rpc("update_study_funding_status_admin", {
        p_id: id,
        p_status: status,
      });
      if (error) {
        safeError("useUpdateStudyFundingStatusAdmin.error", error);
        throw new Error(error.message);
      }
      }
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-studies"] });
    },
  });
}
