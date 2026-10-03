import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import type { Database } from "@/integrations/db/types";
import { 
  parseRpcArray, 
  consultantUserRegistrationSchema,
  userCheckInSummarySchema,
  userLabResultSchema,
  userDosingLogSummarySchema,
  userQuestionnaireResponseSchema,
  userConsentSchema,
} from "@/lib/validation/rpcSchemas";

// Types from Supabase RPC
type CheckInType = Database["public"]["Enums"]["check_in_type"];

export interface ConsultantUser {
  registration_id: string;
  user_id: string;
  study_id: string;
  study_name: string;
  study_code: string;
  status: string;
  enrolled_at: string | null;
  profile: {
    display_name: string | null;
  } | null;
}

export interface UserTrackingData {
  checkIns: {
    id: string;
    check_in_date: string;
    check_in_type: CheckInType | null;
    pain_level: number | null;
    energy_level: number | null;
    mood_level: number | null;
    sleep_hours: number | null;
    sleep_quality: number | null;
  }[];
  labResults: {
    id: string;
    test_date: string;
    status: string;
    crp: number | null;
    esr: number | null;
    vitamin_d: number | null;
    vitamin_b12: number | null;
    glucose: number | null;
    hba1c: number | null;
    insulin: number | null;
    cholesterol_total: number | null;
    hdl: number | null;
    ldl: number | null;
    triglycerides: number | null;
    ast: number | null;
    alt: number | null;
    nk_cells: number | null;
    cd4_count: number | null;
    cd8_count: number | null;
    il_6: number | null;
    tnf_alpha: number | null;
    nad_nadh_ratio: number | null;
    omega3_index: number | null;
  }[];
  dosingLogs: {
    id: string;
    logged_at: string;
    dose_amount: string | null;
    dose_count: number | null;
  }[];
  questionnaireResponses: {
    id: string;
    completed_at: string;
    questionnaire_id: string;
    questionnaire_name?: string | null;
    questionnaire_name_key?: string | null;
    questionnaire_code?: string | null;
    questionnaire_version?: number | null;
  }[];
  consents: {
    id: string;
    consent_type: string;
    granted: boolean;
    granted_at: string | null;
  }[];
}

// Helper to check if error is RPC not found (kept for potential future use)
// const isRpcNotFoundError = (error: unknown): boolean => {
//   if (!error || typeof error !== "object") return false;
//   const maybeError = error as { code?: string };
//   return maybeError.code === "42883" || maybeError.code === "PGRST202";
// };

/**
 * Hook to fetch users assigned to the current consultant.
 * Combines registration data with minimal profile information.
 *
 * @returns Query object containing list of consultant's users.
 */
export function useConsultantUsers() {
  const { user } = useSession();

  return useQuery({
    queryKey: ["consultant-users", user?.id],
    queryFn: async () => {
      if (!user) return [];

      // RPC-only pattern
      const { data: rpcData, error: rpcError } = await aisha.rpc("get_consultant_users");

      if (rpcError) {
        throw rpcError;
      }

      const registrations = parseRpcArray(consultantUserRegistrationSchema, rpcData, "get_consultant_users");

      if (registrations.length === 0) return [];

      // Get partner profile ID via RPC
      const { data: partnerProfileId, error: partnerError } = await aisha.rpc("get_partner_profile_id");

      if (partnerError || !partnerProfileId) return [];

      // Get minimal member info via existing RPC
      const { data: memberInfo } = await aisha
        .rpc("get_study_member_info", { p_partner_id: partnerProfileId }) as { 
          data: { user_id: string; display_name: string }[] | null; 
          error: Error | null 
        };

      const displayNameByUserId = new Map(
        (memberInfo ?? []).map(m => [m.user_id, m.display_name])
      );

      // Map to ConsultantUser - Zod validated registrations, no cast needed
      return registrations.map((e): ConsultantUser => ({
        registration_id: e.registration_id,
        user_id: e.user_id,
        study_id: e.study_id,
        study_name: e.study_name,
        study_code: e.study_code,
        status: e.status,
        enrolled_at: e.enrolled_at,
        profile: {
          display_name: displayNameByUserId.get(e.user_id) ?? null,
        },
      }));
    },
    enabled: !!user,
  });
}

/**
 * Hook to fetch comprehensive health data for a specific user.
 * Uses audited RPCs to retrieve check-ins, lab results, dosing logs, questionnaires, and consents.
 * Requires explicit consent from the user.
 *
 * @param userId - The UUID of the user.
 * @returns Query object containing user's health data.
 */
export function useUserTrackingData(userId: string | null) {
  const { user } = useSession();

  return useQuery({
    queryKey: ["user-health-data", user?.id, userId],
    queryFn: async () => {
      if (!user?.id) return null;
      if (!userId) return null;

      // Use Audited RPCs for sensitive data access - RPC-only pattern
      const [checkInsRes, labResultsRes, dosingLogsRes, questionnairesRes, consentsRes] = await Promise.all([
        aisha.rpc("get_user_health_check_ins_summary_audited", {
          p_user_id: userId
        }),
        aisha.rpc("get_user_lab_results_audited", {
          p_user_id: userId
        }),
        aisha.rpc("get_user_dosing_logs_summary_audited", {
          p_user_id: userId
        }),
        aisha.rpc("get_user_questionnaire_responses_audited", {
          p_limit: 10
,
          p_user_id: userId
    }),
        aisha.rpc("get_user_consents_audited", {
          p_user_id: userId
        }),
      ]);

      // Validate RPC responses with Zod schemas
      const validatedCheckIns = parseRpcArray(
        userCheckInSummarySchema, 
        checkInsRes.data, 
        "get_user_health_check_ins_summary_audited"
      );
      const validatedLabResults = parseRpcArray(
        userLabResultSchema, 
        labResultsRes.data, 
        "get_user_lab_results_audited"
      );
      const validatedDosingLogs = parseRpcArray(
        userDosingLogSummarySchema, 
        dosingLogsRes.data, 
        "get_user_dosing_logs_summary_audited"
      );
      const validatedQuestionnaires = parseRpcArray(
        userQuestionnaireResponseSchema, 
        questionnairesRes.data, 
        "get_user_questionnaire_responses_audited"
      );
      const validatedConsents = parseRpcArray(
        userConsentSchema, 
        consentsRes.data, 
        "get_user_consents_audited"
      );

      // Map validated data to UserTrackingData structure
      return {
        checkIns: validatedCheckIns.map((ci) => ({
          id: ci.check_in_date, // Use check_in_date as fallback id
          check_in_date: ci.check_in_date,
          check_in_type: null, // RPC doesn't return check_in_type
          pain_level: ci.pain_level,
          energy_level: ci.energy_level,
          mood_level: ci.mood_level,
          sleep_hours: null, // RPC doesn't return sleep_hours
          sleep_quality: ci.sleep_quality,
        })),
        labResults: validatedLabResults,
        dosingLogs: validatedDosingLogs.map((d) => ({
          id: d.logged_at, // Use logged_at as fallback id
          logged_at: d.logged_at,
          dose_amount: null, // RPC returns dose_count, not dose_amount
          dose_count: d.dose_count,
        })),
        questionnaireResponses: validatedQuestionnaires.map((q) => ({
          id: q.id,
          completed_at: q.completed_at,
          questionnaire_id: q.questionnaire_id,
          questionnaire_name: q.questionnaire_name ?? null,
          questionnaire_name_key: q.questionnaire_name_key ?? null,
          questionnaire_code: q.questionnaire_code ?? null,
          questionnaire_version: q.questionnaire_version ?? null,
        })),
        consents: validatedConsents,
      } satisfies UserTrackingData;
    },
    enabled: !!user?.id && !!userId,
  });
}
