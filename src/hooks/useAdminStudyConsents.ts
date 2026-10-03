import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import {
  parseRpcArray,
  consentTemplateAdminSchema,
  studyConsentRequirementAdminSchema,
  studyQuestionnaireAdminSchema,
  questionnaireAdminSchema,
} from "@/lib/validation/rpcSchemas.admin";
import type { z } from "zod";
import { usePermissions } from "./usePermissions";
import { useSession } from "./useSession";
import { useAdminGuard } from "@/hooks/useAdminGuard";

export type ConsentTemplateAdmin = z.infer<typeof consentTemplateAdminSchema>;
export type StudyConsentRequirementAdmin = z.infer<typeof studyConsentRequirementAdminSchema>;
export type StudyQuestionnaireAdmin = z.infer<typeof studyQuestionnaireAdminSchema>;
export type QuestionnaireAdmin = z.infer<typeof questionnaireAdminSchema>;

export type SupportedLocale = "cs" | "en";

/**
 * Imperative function to fetch translations for keys (for use in handlers).
 * @param keys - Array of translation keys
 * @param namespace - Translation namespace
 * @returns Promise with translations map
 */
export async function fetchTranslationsForKeys(
  keys: string[],
  namespace: string
): Promise<Record<string, Record<SupportedLocale, string>>> {
  if (keys.length === 0) return {};

  const { data, error } = await aisha.rpc("get_translations_for_keys", {
    p_keys: keys,
    p_namespace: namespace,
  });
  if (error) throw new Error(error.message);

  const result: Record<string, Record<SupportedLocale, string>> = {};
  for (const key of keys) {
    result[key] = { cs: "", en: "" };
  }

  const translations = data as Array<{ key: string; locale: string; value: string }> | null;
  if (translations) {
    for (const tr of translations) {
      if (result[tr.key] && (tr.locale === "cs" || tr.locale === "en")) {
        result[tr.key][tr.locale as SupportedLocale] = tr.value;
      }
    }
  }

  return result;
}
/**
 * Hook for fetching consent templates
 */
export function useConsentTemplatesAdmin() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["admin-consent-templates"],
    queryFn: async () => {
      if (!isAdmin || !user) return [];
      const { data, error } = await aisha.rpc("get_consent_templates_admin");
      if (error) {
        safeError("admin.consentTemplates.fetchFailed", error);
        throw new Error(error.message);
      }
      return parseRpcArray(consentTemplateAdminSchema, data, "get_consent_templates_admin");
    },
    enabled: isAdmin && !!user,
  });
}

/**
 * Hook for fetching study consent requirements
 */
export function useStudyConsentRequirementsAdmin(studyId: string | undefined) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["admin-study-consent-requirements", studyId],
    queryFn: async () => {
      if (!studyId || !isAdmin || !user) return [];
      const { data, error } = await aisha.rpc("get_study_consent_requirements_admin", {
        p_study_id: studyId,
      });
      if (error) {
        safeError("admin.consentRequirements.fetchFailed", error);
        throw new Error(error.message);
      }
      return parseRpcArray(studyConsentRequirementAdminSchema, data, "get_study_consent_requirements_admin");
    },
    enabled: Boolean(studyId) && isAdmin && !!user,
  });
}

/**
 * Hook for fetching study questionnaires
 */
export function useStudyQuestionnairesAdmin(studyId: string | undefined) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["admin-study-questionnaires", studyId],
    queryFn: async () => {
      if (!studyId || !isAdmin || !user) return [];
      const { data, error } = await aisha.rpc("get_study_questionnaires_admin", {
        p_study_id: studyId,
      });
      if (error) {
        safeError("admin.studyQuestionnaires.fetchFailed", error);
        throw new Error(error.message);
      }
      return parseRpcArray(studyQuestionnaireAdminSchema, data, "get_study_questionnaires_admin");
    },
    enabled: Boolean(studyId) && isAdmin && !!user,
  });
}

/**
 * Hook for fetching questionnaires for linking
 */
export function useQuestionnairesAdmin() {
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
      return parseRpcArray(questionnaireAdminSchema, data, "get_questionnaires_admin");
    },
    enabled: isAdmin && !!user,
  });
}

/**
 * Hook for fetching translations for keys
 */
export function useTranslationsForKeys(keys: string[], namespace: string) {
  return useQuery({
    queryKey: ["translations-for-keys", keys, namespace],
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
      
      const result: Record<string, Record<string, string>> = {};
      for (const key of keys) {
        result[key] = { cs: "", en: "" };
      }
      
      const translations = data as Array<{ key: string; locale: string; value: string }> | null;
      if (translations) {
        for (const tr of translations) {
          if (result[tr.key]) {
            result[tr.key][tr.locale] = tr.value;
          }
        }
      }
      
      return result;
    },
    enabled: keys.length > 0,
  });
}

// Mutations

export function useCreateConsentTemplateMutation() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("create_consent_template_admin", async (payload: {
      template_key: string;
      title_key?: string;
      content_key?: string;
      description_key?: string;
      checkbox_label_key?: string;
      version: string;
      is_active: boolean;
      requires_signature: boolean;
    }) => {
      const { error } = await aisha.rpc("create_consent_template_admin", {
        p_checkbox_label_key: payload.checkbox_label_key,
        p_content_key: payload.content_key,
        p_description_key: payload.description_key,
        p_is_active: payload.is_active,
        p_requires_signature: payload.requires_signature,
        p_template_key: payload.template_key,
        p_title_key: payload.title_key,
        p_version: payload.version
    });
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-consent-templates"] });
      queryClient.invalidateQueries({ queryKey: ["translations"] });
    },
    onError: (error) => {
      safeError("admin.consentTemplates.createFailed", error);
    },
  });
}

export function useDeleteConsentTemplateMutation() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("delete_consent_template_admin", async (id: string) => {
      const { error } = await aisha.rpc("delete_consent_template_admin", { p_id: id });
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-consent-templates"] });
    },
    onError: (error) => {
      safeError("admin.consentTemplates.deleteFailed", error);
    },
  });
}

export function useUpsertStudyConsentRequirementMutation(studyId: string | undefined) {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("upsert_study_consent_requirement_admin", async (payload: {
      study_id: string;
      consent_template_id: string;
      is_required: boolean;
      sort_order: number;
    }) => {
      const { error } = await aisha.rpc("upsert_study_consent_requirement_admin", {
        p_consent_template_id: payload.consent_template_id,
        p_is_required: payload.is_required,
        p_sort_order: payload.sort_order
,
        p_study_id: payload.study_id
    });
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-study-consent-requirements", studyId] });
    },
    onError: (error) => {
      safeError("admin.consentRequirements.upsertFailed", error);
    },
  });
}

export function useDeleteStudyConsentRequirementMutation(studyId: string | undefined) {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("delete_study_consent_requirement_admin", async (id: string) => {
      const { error } = await aisha.rpc("delete_study_consent_requirement_admin", { p_id: id });
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-study-consent-requirements", studyId] });
    },
    onError: (error) => {
      safeError("admin.consentRequirements.deleteFailed", error);
    },
  });
}

export function useUpsertStudyQuestionnaireMutation(studyId: string | undefined) {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("upsert_study_questionnaire_admin", async (payload: {
      study_id: string;
      questionnaire_id: string;
      questionnaire_type: string;
      is_required: boolean;
      is_active: boolean;
      frequency_type: string;
      frequency_days?: number;
      token_reward: number;
      display_order: number;
      starts_after_days: number;
      ends_after_days?: number;
      title_key: string;
      description_key: string;
    }) => {
      const { error } = await aisha.rpc("upsert_study_questionnaire_admin", {
        p_description_key: payload.description_key,
        p_display_order: payload.display_order,
        p_ends_after_days: payload.ends_after_days,
        p_frequency_days: payload.frequency_days,
        p_frequency_type: payload.frequency_type,
        p_is_active: payload.is_active,
        p_is_required: payload.is_required,
        p_questionnaire_id: payload.questionnaire_id,
        p_questionnaire_type: payload.questionnaire_type,
        p_starts_after_days: payload.starts_after_days,
        p_study_id: payload.study_id,
        p_title_key: payload.title_key,
        p_token_reward: payload.token_reward,
    });
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-study-questionnaires", studyId] });
      queryClient.invalidateQueries({ queryKey: ["translations"] });
    },
    onError: (error) => {
      safeError("admin.studyQuestionnaires.upsertFailed", error);
    },
  });
}

export function useDeleteStudyQuestionnaireMutation(studyId: string | undefined) {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("delete_study_questionnaire_admin", async (id: string) => {
      const { error } = await aisha.rpc("delete_study_questionnaire_admin", { p_id: id });
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-study-questionnaires", studyId] });
    },
    onError: (error) => {
      safeError("admin.studyQuestionnaires.deleteFailed", error);
    },
  });
}
