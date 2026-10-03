import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import type { Json } from "@/integrations/db/types";
import { z } from "zod";
import { usePermissions } from "./usePermissions";
import { useSession } from "./useSession";
import { useAdminGuard } from "@/hooks/useAdminGuard";

/**
 * Standardized questionnaire type values.
 * Used in both `questionnaires.questionnaire_type` and `study_questionnaires.questionnaire_type`.
 */
export const QUESTIONNAIRE_TYPES = [
  "assessment",
  "daily_checkin",
  "registration",
  "intake",
  "monthly_assessment",
  "progress",
  "qualification",
  "registration",
  "subjective_assessment",
  "survey",
  "test",
  "weekly",
  "weekly_summary",
] as const;

export type QuestionnaireType = (typeof QUESTIONNAIRE_TYPES)[number];

// Extended questionnaire schema with additional fields from RPC
export const questionnaireExtendedSchema = z.object({
  id: z.string().uuid(),
  base_locale: z.string().nullable().optional(),
  code: z.string(),
  created_at: z.string(),
  description_key: z.string().nullable().optional(),
  is_active: z.boolean(),
  name: z.string(),
  name_key: z.string().nullable().optional(),
  points_reward: z.number().nullable().optional(),
  questionnaire_type: z.string().nullable().optional(),
  questions: z.unknown(),
  question_count: z.number().nullable().optional(),
  token_reward: z.number().nullable().optional(),
  updated_at: z.string(),
  version: z.number().nullable().optional(),
});

export type QuestionnaireExtended = z.infer<typeof questionnaireExtendedSchema>;

// Question block schema - matches get_question_blocks_admin RPC return type
const questionBlockSchema = z.object({
  id: z.string(),
  base_locale: z.string(),
  code: z.string(),
  config: z.unknown().optional(),
  created_at: z.string(),
  description_key: z.string().nullable(),
  is_active: z.boolean(),
  is_required_default: z.boolean(),
  question_type: z.string(),
  sort_order: z.number().optional(),
  text_key: z.string(),
  updated_at: z.string(),
});

export type QuestionBlock = z.infer<typeof questionBlockSchema>;

/**
 * Hook for fetching questionnaires with admin privileges
 */
export function useQuestionnairesAdminFull() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["admin-questionnaires"],
    queryFn: async () => {
      if (!isAdmin || !user) return [];
      const { data, error } = await aisha.rpc("get_questionnaires_admin");
      if (error) {
        safeError("admin.questionnaires.fetchFailed", error);
        throw new Error(error.message);
      }

      const parsed = z.array(questionnaireExtendedSchema).safeParse(data);
      return parsed.success ? parsed.data : [];
    },
    enabled: isAdmin && !!user,
  });
}

/**
 * Hook for fetching question blocks
 */
export function useQuestionBlocksAdmin() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["admin-question-blocks"],
    queryFn: async () => {
      if (!isAdmin || !user) return [];
      const { data, error } = await aisha.rpc("get_question_blocks_admin");
      if (error) {
        safeError("admin.questionBlocks.fetchFailed", error);
        throw new Error(error.message);
      }

      const parsed = z.array(questionBlockSchema).safeParse(data);
      return parsed.success ? parsed.data : [];
    },
    enabled: isAdmin && !!user,
  });
}

/**
 * Hook for creating questionnaire
 */
export function useCreateQuestionnaireMutation() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("create_questionnaire_admin", async (payload: {
      base_locale?: string;
      code: string;
      description_key?: string;
      is_active?: boolean;
      name: string;
      name_key?: string;
      points_reward?: number;
      questionnaire_type?: string;
      questions?: Json;
      token_reward?: number;
    }) => {
      const { error } = await aisha.rpc("create_questionnaire_admin", {
        p_base_locale: payload.base_locale,
        p_code: payload.code,
        p_description_key: payload.description_key,
        p_is_active: payload.is_active,
        p_name: payload.name,
        p_name_key: payload.name_key,
        p_points_reward: payload.points_reward,
        p_questionnaire_type: payload.questionnaire_type,
        p_questions: payload.questions,
        p_token_reward: payload.token_reward,
    });
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-questionnaires"] });
    },
    onError: (error) => {
      safeError("admin.questionnaires.createFailed", error);
    },
  });
}

/**
 * Hook for updating questionnaire
 */
export function useUpdateQuestionnaireMutation() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("update_questionnaire_admin", async (payload: {
      id: string;
      base_locale?: string;
      code?: string;
      description_key?: string;
      is_active?: boolean;
      name?: string;
      name_key?: string;
      points_reward?: number;
      questionnaire_type?: string;
      questions?: Json;
      token_reward?: number;
    }) => {
      const { error } = await aisha.rpc("update_questionnaire_admin", {
        p_base_locale: payload.base_locale,
        p_code: payload.code,
        p_description_key: payload.description_key,
        p_id: payload.id,
        p_is_active: payload.is_active,
        p_name: payload.name,
        p_name_key: payload.name_key,
        p_points_reward: payload.points_reward,
        p_questionnaire_type: payload.questionnaire_type,
        p_questions: payload.questions,
        p_token_reward: payload.token_reward,
    });
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-questionnaires"] });
    },
    onError: (error) => {
      safeError("admin.questionnaires.updateFailed", error);
    },
  });
}

/**
 * Hook for deleting questionnaire
 */
export function useDeleteQuestionnaireMutation() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("delete_questionnaire_admin", async (id: string) => {
      const { error } = await aisha.rpc("delete_questionnaire_admin", {
        p_id: id,
      });
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-questionnaires"] });
    },
    onError: (error) => {
      safeError("admin.questionnaires.deleteFailed", error);
    },
  });
}

/**
 * Hook for creating question block
 */
export function useCreateQuestionBlockMutation() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("create_question_block_admin", async (payload: {
      block_key: string;
      questions: Json;
      is_active: boolean;
      sort_order?: number;
    }) => {
      const { error } = await aisha.rpc("create_question_block_admin", {
        p_block_key: payload.block_key,
        p_is_active: payload.is_active,
        p_questions: payload.questions,
        p_sort_order: payload.sort_order ?? 0
    });
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-question-blocks"] });
    },
    onError: (error) => {
      safeError("admin.questionBlocks.createFailed", error);
    },
  });
}

/**
 * Hook for updating question block
 */
export function useUpdateQuestionBlockMutation() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("update_question_block_admin", async (payload: {
      id: string;
      block_key?: string;
      questions?: Json;
      is_active?: boolean;
      sort_order?: number;
    }) => {
      const { error } = await aisha.rpc("update_question_block_admin", {
        p_block_key: payload.block_key ?? undefined,
        p_id: payload.id,
        p_is_active: payload.is_active ?? undefined,
        p_questions: payload.questions ?? undefined,
        p_sort_order: payload.sort_order ?? undefined
    });
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-question-blocks"] });
    },
    onError: (error) => {
      safeError("admin.questionBlocks.updateFailed", error);
    },
  });
}

/**
 * Hook for deleting question block
 */
export function useDeleteQuestionBlockMutation() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("delete_question_block_admin", async (id: string) => {
      const { error } = await aisha.rpc("delete_question_block_admin", {
        p_id: id,
      });
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-question-blocks"] });
    },
    onError: (error) => {
      safeError("admin.questionBlocks.deleteFailed", error);
    },
  });
}

/**
 * Hook for fetching translations for specific keys
 */
export function useQuestionnaireTranslations(keys: string[], namespace: string) {
  return useQuery({
    queryKey: ["questionnaire-translations", keys, namespace],
    queryFn: async () => {
      if (keys.length === 0) return {};

      const { data, error } = await aisha.rpc("get_translations_for_keys", {
        p_keys: keys,
        p_namespace: namespace,
      });

      if (error) {
        safeError("translations.fetchFailed", error);
        throw new Error(error.message);
      }

      const translationRowSchema = z.object({
        key: z.string(),
        locale: z.string(),
        value: z.string(),
      });
      const parseResult = z.array(translationRowSchema).safeParse(data);
      const translations = parseResult.success ? parseResult.data : [];

      const result: Record<string, Record<string, string>> = {};
      translations.forEach((row) => {
        if (!result[row.key]) {
          result[row.key] = {};
        }
        result[row.key][row.locale] = row.value;
      });

      return result;
    },
    enabled: keys.length > 0,
  });
}
