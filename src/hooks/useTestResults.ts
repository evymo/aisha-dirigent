import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import { QUALIFICATION_TEST_QUESTIONNAIRE_ID } from "@/lib/studyRegistrationSchema";
import type { Database } from "@/integrations/db/types";

// Types from Supabase RPC
type QualificationResultRow = Database["public"]["Functions"]["get_my_qualification_results"]["Returns"][number];
type PartnerCertificationRow = Database["public"]["Functions"]["get_my_partner_certification"]["Returns"][number];

// Response shape for qualification test
interface QualificationResponses {
  score?: number;
  passed?: boolean;
  completedAt?: string;
  answers?: Record<string, string>;
}

/**
 * Represents the result of a qualification test.
 */
export interface QualificationTestResult {
  id: string;
  user_id: string;
  score: number;
  passed: boolean;
  completedAt: string;
  created_at: string;
}

/**
 * Represents the result of a partner certification test.
 */
export interface PartnerCertificationResult {
  id: string;
  partner_id: string;
  user_id: string | null;
  score: number;
  passed: boolean;
  answers: Record<string, unknown>;
  completed_at: string | null;
  created_at: string | null;
}

/**
 * Hook to fetch the current user's qualification test results.
 *
 * @returns Query object containing the qualification test result, or null if not found.
 */
export function useMyQualificationResults() {
  const { user } = useSession();

  return useQuery({
    queryKey: ["my-qualification-results", user?.id],
    queryFn: async () => {
      if (!user) return null;

      // Get from questionnaire_responses using RPC
      const { data, error: responseError } = await aisha.rpc(
        "get_my_qualification_results",
        { p_questionnaire_id: QUALIFICATION_TEST_QUESTIONNAIRE_ID }
      );

      if (responseError) throw responseError;

      if (data && data.length > 0) {
        const result = data[0] as QualificationResultRow;
        const responses = result.responses as QualificationResponses | null;
        return {
          id: result.id,
          user_id: result.user_id,
          score: responses?.score ?? 0,
          passed: responses?.passed ?? false,
          completedAt: responses?.completedAt ?? result.completed_at ?? "",
          created_at: result.created_at ?? "",
        } satisfies QualificationTestResult;
      }

      return null;
    },
    enabled: !!user,
  });
}

/**
 * Hook to fetch the current user's partner certification results.
 *
 * @returns Query object containing the partner certification result, or null if not found.
 */
export function useMyPartnerCertification() {
  const { user } = useSession();

  return useQuery({
    queryKey: ["my-partner-certification", user?.id],
    queryFn: async () => {
      if (!user) return null;

      const { data, error } = await aisha.rpc("get_my_partner_certification");

      if (error) throw new Error(error.message);

      if (data && data.length > 0) {
        const row = data[0] as PartnerCertificationRow;
        // Note: partner_id doesn't exist on PartnerCertificationRow, use user_id instead
        return {
          id: row.id,
          partner_id: row.user_id ?? "", // Use user_id as fallback
          user_id: row.user_id ?? null,
          score: row.score,
          passed: row.passed,
          answers: row.answers as Record<string, unknown>,
          completed_at: row.completed_at,
          created_at: row.created_at,
        } satisfies PartnerCertificationResult;
      }

      return null;
    },
    enabled: !!user,
  });
}

// Combined hook for all test results
export function useMyTestResults() {
  const qualificationQuery = useMyQualificationResults();
  const certificationQuery = useMyPartnerCertification();

  return {
    qualification: qualificationQuery.data,
    certification: certificationQuery.data,
    isLoading: qualificationQuery.isLoading || certificationQuery.isLoading,
    qualificationLoading: qualificationQuery.isLoading,
    certificationLoading: certificationQuery.isLoading,
  };
}
