import { useState, useEffect, useCallback } from "react";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { getUserFacingDataErrorMessage } from "@/lib/security/userFacingErrors";
import { usePermissions } from "./usePermissions";
import { useIsMountedRef } from "./useIsMountedRef";
import { RegistrationWithDetails, useAllRegistrations } from "./useAdminData";

/**
 * Questionnaire response with decoded responses.
 */
export interface QuestionnaireResponse {
  /** Unique identifier for the response */
  id: string;
  /** ID of the questionnaire */
  questionnaire_id: string;
  /** When the questionnaire was completed */
  completed_at: string | null;
  /** Response data (questions and answers) */
  responses: Record<string, unknown>;
}

/**
 * Full registration detail including questionnaire responses.
 */
export interface RegistrationDetail {
  /** Basic registration info */
  registration: RegistrationWithDetails | null;
  /** Questionnaire responses for this registration */
  questionnaireResponses: QuestionnaireResponse[];
}

/**
 * Hook to fetch detailed information about a specific registration, including questionnaire responses.
 * Restricted to admins and staff.
 * 
 * @param registrationId - The ID of the registration to fetch
 * @returns Object containing registration detail, loading state, error state, and refetch function.
 * 
 * @example
 * ```tsx
 * const { registration, questionnaireResponses, isLoading, error } = useRegistrationDetail(registrationId);
 * ```
 */
export function useRegistrationDetail(registrationId: string | undefined) {
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");
  const { registrations } = useAllRegistrations();
  
  const [questionnaireResponses, setQuestionnaireResponses] = useState<QuestionnaireResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useIsMountedRef();

  // Find registration from the list
  const registration = registrationId 
    ? registrations.find(e => e.id === registrationId) ?? null 
    : null;

  const fetchQuestionnaireResponses = useCallback(async () => {
    if (!isAdmin || !registrationId) {
      if (isMountedRef.current) {
        setQuestionnaireResponses([]);
        setIsLoading(false);
      }
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const { data, error: rpcError } = await aisha.rpc(
        "get_registration_questionnaire_responses",
        { p_registration_id: registrationId }
      );

      if (rpcError) throw rpcError;

      if (isMountedRef.current) {
        const responses: QuestionnaireResponse[] = (data ?? []).map((item: {
          id: string;
          questionnaire_id: string;
          completed_at: string | null;
          responses: unknown;
        }) => ({
          id: item.id,
          questionnaire_id: item.questionnaire_id,
          completed_at: item.completed_at,
          responses: (item.responses as Record<string, unknown>) ?? {},
        }));
        setQuestionnaireResponses(responses);
      }
    } catch (err) {
      safeError("Error fetching registration questionnaire responses", err);
      if (isMountedRef.current) {
        setError(getUserFacingDataErrorMessage(err));
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [isAdmin, registrationId, isMountedRef]);

  useEffect(() => {
    fetchQuestionnaireResponses();
  }, [fetchQuestionnaireResponses]);

  return {
    registration,
    questionnaireResponses,
    isLoading,
    error,
    refetch: fetchQuestionnaireResponses,
  };
}
