import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useAdminGuard } from "@/hooks/useAdminGuard";
import { usePermissions } from "@/hooks/usePermissions";
import { useTranslation } from "react-i18next";
import { parseArrayResponseSafe, parseRpcResponseSafe } from "@/lib/schemas/hookSchemas";
import {
  testQuestionPublicArraySchema,
  testQuestionAdminArraySchema,
  validateTestAnswersResultSchema,
  type TestQuestionPublicRpc,
  type TestQuestionAdminRpc,
} from "@/lib/schemas/testQuestionSchemas";

/**
 * Represents a test question with all details, including the correct answer.
 * This interface is typically used in admin contexts.
 */
export type TestQuestion = TestQuestionAdminRpc;

/**
 * Represents a test question for public display.
 * Does NOT include the correct answer to prevent cheating.
 */
export type TestQuestionPublic = TestQuestionPublicRpc;

/**
 * Hook to fetch test questions for public use (e.g., taking a test).
 * Uses a secure RPC function that excludes the correct answer.
 *
 * @param testType - The type of test (e.g., "qualification", "certification").
 * @returns Query object containing the list of public test questions.
 */
export function useTestQuestions(testType: "qualification" | "certification") {
  const { i18n } = useTranslation();

  return useQuery({
    queryKey: ["test-questions-public", testType, i18n.language],
    queryFn: async () => {
      // Use localized RPC
      const { data, error } = await aisha.rpc("get_test_questions_public_localized", {
        p_locale: i18n.language,
        p_test_type: testType,
      });

      if (error) throw new Error(error.message);

      // Validate with Zod schema
      return parseArrayResponseSafe(
        testQuestionPublicArraySchema,
        data,
        "get_test_questions_public_localized"
      );
    },
  });
}

/**
 * Hook to validate test answers server-side.
 *
 * @returns Mutation object for validating answers.
 */
export function useValidateTestAnswers() {
  return useMutation({
    mutationFn: async ({ testType, answers }: { testType: string; answers: Record<string, string> }) => {
      const { data, error } = await aisha.rpc("validate_test_answers", {
        p_answers: answers
        ,
        p_test_type: testType
      });

      if (error) throw new Error(error.message);

      // Validate with Zod schema
      const validated = parseRpcResponseSafe(
        validateTestAnswersResultSchema,
        data,
        "validate_test_answers"
      );

      if (!validated) {
        throw new Error("Invalid response from validate_test_answers");
      }

      return validated;
    },
  });
}

/**
 * Hook to fetch all test questions, including correct answers (admin only).
 *
 * @param testType - The type of test.
 * @returns Query object containing the full list of test questions.
 */
export function useAllTestQuestions(testType: "qualification" | "certification") {
  const { hasPermission } = usePermissions();
  const { i18n } = useTranslation();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["all-test-questions", testType, i18n.language],
    queryFn: async () => {
      if (!isAdmin) return [];
      // Use localized RPC
      const { data, error } = await aisha.rpc("get_test_questions_admin_localized", {
        p_locale: i18n.language,
        p_test_type: testType,
      });

      if (error) throw new Error(error.message);

      // Validate with Zod schema
      return parseArrayResponseSafe(
        testQuestionAdminArraySchema,
        data,
        "get_test_questions_admin_localized"
      );
    },
    enabled: isAdmin,
  });
}

/**
 * Hook to create a new test question (admin only).
 *
 * @returns Mutation object for creating a test question.
 */
type CreateTestQuestionInput = Omit<TestQuestion, "id" | "created_at" | "updated_at">;

export function useCreateTestQuestion() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation<string, Error, CreateTestQuestionInput>({
    mutationFn: async (question: CreateTestQuestionInput) => {
      // Check admin permissions first
      const wrappedFn = guardAdminMutation<CreateTestQuestionInput, string>(
        "create_test_question_admin",
        async (q: CreateTestQuestionInput) => {
          // RPC-only pattern
          const { data, error } = await aisha.rpc("create_test_question_admin", {
            p_correct_answer: q.correct_answer,
            p_is_active: q.is_active,
            p_question_order: q.question_order,
            p_test_type: q.test_type
          });

          if (error) throw new Error(error.message);
          return data as string;
        }
      );
      return wrappedFn(question);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["test-questions", variables.test_type] });
      queryClient.invalidateQueries({ queryKey: ["all-test-questions", variables.test_type] });
    },
  });
}

/**
 * Hook to update an existing test question (admin only).
 *
 * @returns Mutation object for updating a test question.
 */
export function useUpdateTestQuestion() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("update_test_question_admin", async ({ id, ...updates }: Partial<TestQuestion> & { id: string }) => {
      // RPC-only pattern
      const { data, error } = await aisha.rpc("update_test_question_admin", {
        p_correct_answer: updates.correct_answer ?? undefined,
        p_is_active: updates.is_active ?? undefined,
        p_question_id: id,
        p_question_order: updates.question_order ?? undefined
      });

      if (error) throw new Error(error.message);
      // RPC returns just the ID (string)
      return data;
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["test-questions"] });
      queryClient.invalidateQueries({ queryKey: ["all-test-questions"] });
    },
  });
}

/**
 * Hook to delete a test question (admin only).
 *
 * @returns Mutation object for deleting a test question.
 */
export function useDeleteTestQuestion() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("delete_test_question_admin", async (id: string) => {
      // RPC-only pattern
      const { error } = await aisha.rpc("delete_test_question_admin", {
        p_question_id: id,
      });

      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["test-questions"] });
      queryClient.invalidateQueries({ queryKey: ["all-test-questions"] });
    },
  });
}

/**
 * Hook to fetch test results for admin review.
 *
 * @param testType - The type of test results to fetch.
 * @returns Query object containing the list of test results.
 */
export function useTestResults(testType: "qualification" | "certification") {
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["test-results", testType],
    queryFn: async () => {
      if (!isAdmin) return [];
      // RPC-only pattern
      if (testType === "qualification") {
        const { data, error } = await aisha.rpc("get_qualification_test_results_admin");
        if (error) throw new Error(error.message);
        return data ?? [];
      } else {
        const { data, error } = await aisha.rpc("get_certification_test_results_admin");
        if (error) throw new Error(error.message);
        return data ?? [];
      }
    },
    enabled: isAdmin,
  });
}
