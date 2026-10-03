import { useMutation } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";
import { QUALIFICATION_TEST_QUESTIONNAIRE_ID } from "@/lib/studyRegistrationSchema";

// Result schema
const qualificationResultSchema = z.object({
  success: z.boolean(),
  passed: z.boolean(),
  total_questions: z.number(),
  correct_count: z.number(),
  score: z.number(),
  role_assigned: z.boolean(),
});

export type QualificationResult = z.infer<typeof qualificationResultSchema>;

interface SubmitQualificationParams {
  answers: Record<string, string>;
}

/**
 * Hook for submitting qualification test and assigning member role if passed
 */
export function useSubmitQualificationTest() {
  return useMutation({
    mutationFn: async (params: SubmitQualificationParams): Promise<QualificationResult> => {
      const { data, error } = await aisha.rpc("assign_member_role_after_qualification", {
        p_answers: params.answers
,
        p_test_type: "qualification"
    });

      if (error) throw new Error(error.message);

      const parsed = qualificationResultSchema.safeParse(data);
      if (!parsed.success) {
        safeError("qualificationTest.parseError", parsed.error);
        return data as QualificationResult;
      }

      return parsed.data;
    },
    onError: (error) => {
      safeError("qualificationTest.submit.failed", error);
    },
  });
}

/**
 * Hook for storing qualification test response
 */
export function useSaveQualificationResponse() {
  return useMutation({
    mutationFn: async (params: {
      answers: Record<string, string>;
      score: number;
      passed: boolean;
    }): Promise<string | null> => {
      const { data, error } = await aisha.rpc("insert_questionnaire_response_secure", {
        p_questionnaire_id: QUALIFICATION_TEST_QUESTIONNAIRE_ID,
        p_responses: {
          answers: params.answers,
          score: params.score,
          passed: params.passed,
          completedAt: new Date().toISOString(),
        },
        p_study_registration_id: undefined,
      });

      if (error) {
        safeError("qualificationTest.storeResult.failed", error);
        throw new Error(error.message);
      }

      return typeof data === "string" ? data : null;
    },
  });
}
