import { useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError, safeInfo } from "@/lib/security/safeLogger";
import {
  validateBlockResponse,
  type BlockResponse,
} from "@/schemas/questionResponseSchemas";

/**
 * Context types for block responses.
 */
export type BlockResponseContext = "onboarding" | "check_in" | "questionnaire";

/**
 * Input for submitting a block response.
 */
export interface SubmitBlockResponseInput {
  contextType: BlockResponseContext;
  blockCode: string;
  questionType: string;
  response: BlockResponse;
  contextId?: string;
}

/**
 * Result from submit_block_response_audited RPC.
 */
export interface SubmitBlockResponseResult {
  response_id: string;
  block_code: string;
  question_type: string;
  context_type: string;
  context_id: string | null;
  response: BlockResponse;
  validated: boolean;
}

/**
 * Hook for submitting question block responses with Zod validation and audit.
 * 
 * Validates response against schema before sending to RPC.
 * RPC performs additional validation against block config.
 */
export function useSubmitBlockResponse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SubmitBlockResponseInput): Promise<SubmitBlockResponseResult> => {
      const { contextType, blockCode, questionType, response, contextId } = input;

      // Frontend Zod validation
      const validatedResponse = validateBlockResponse(questionType, response);

      // Call audited RPC
      const { data, error } = await aisha.rpc("submit_block_response_audited", {
        p_block_code: blockCode,
        p_context_id: contextId
,
        p_context_type: contextType,
        p_question_type: questionType,
        p_response: JSON.parse(JSON.stringify(validatedResponse))
    });

      if (error) {
        safeError("questionnaire.block.response.submit.failed", error);
        throw new Error(error.message);
      }

      safeInfo("questionnaire.block.response.submitted", {
        blockCode,
        questionType,
        contextType,
      });

      // Parse response from RPC
      const result = data as unknown as SubmitBlockResponseResult;
      return result;
    },
    onSuccess: (_data, variables) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({
        queryKey: ["block-responses", variables.contextType, variables.contextId],
      });
    },
  });
}

/**
 * Hook for submitting multiple block responses in batch.
 */
export function useSubmitBlockResponses() {
  const submitSingle = useSubmitBlockResponse();

  return useMutation({
    mutationFn: async (inputs: SubmitBlockResponseInput[]): Promise<SubmitBlockResponseResult[]> => {
      const results: SubmitBlockResponseResult[] = [];

      for (const input of inputs) {
        const result = await submitSingle.mutateAsync(input);
        results.push(result);
      }

      return results;
    },
  });
}
