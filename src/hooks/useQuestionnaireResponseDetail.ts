import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";

/**
 * Schema for a single answer within the response detail.
 */
const responseAnswerSchema = z.object({
  questionId: z.string().optional(),
  question_id: z.string().optional(),
  blockCode: z.string().optional(),
  block_code: z.string().optional(),
  type: z.string().optional(),
  value: z.unknown(),
  textKey: z.string().optional(),
  text_key: z.string().optional(),
});

/**
 * Schema for the response detail returned from the RPC.
 */
const responseDetailSchema = z.object({
  completed_at: z.string().nullable(),
  created_at: z.string().nullable(),
  id: z.string(),
  questionnaire_code: z.string().nullable(),
  questionnaire_description: z.string().nullable(),
  questionnaire_description_key: z.string().nullable(),
  questionnaire_id: z.string(),
  questionnaire_name: z.string().nullable(),
  questionnaire_name_key: z.string().nullable(),
  questionnaire_questions: z.array(z.unknown()).nullable(),
  questionnaire_type: z.string().nullable(),
  questionnaire_version: z.number().nullable(),
  response_version: z.number().nullable(),
  responses: z.array(responseAnswerSchema).or(z.record(z.unknown())).or(z.unknown()),
  score: z.number().nullable(),
  user_id: z.string(),
});

export type QuestionnaireResponseDetail = z.infer<typeof responseDetailSchema>;

/**
 * Hook to fetch a single questionnaire response detail with audit logging.
 *
 * @param responseId - The UUID of the questionnaire response to fetch
 * @param options - Query options (enabled)
 */
export function useQuestionnaireResponseDetail(
  responseId: string | null,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["questionnaire-response-detail", responseId],
    queryFn: async (): Promise<QuestionnaireResponseDetail> => {
      if (!responseId) throw new Error("Response ID is required");

      const { data, error } = await aisha.rpc(
        "get_questionnaire_response_detail_audited",
        { p_response_id: responseId },
      );

      if (error) {
        safeError("useQuestionnaireResponseDetail.fetch", error);
        throw new Error(error.message);
      }

      if (!data || typeof data !== "object") {
        throw new Error("Empty response data");
      }

      return responseDetailSchema.parse(data);
    },
    enabled: !!responseId && (options?.enabled !== false),
    staleTime: 2 * 60 * 1000,
  });
}
