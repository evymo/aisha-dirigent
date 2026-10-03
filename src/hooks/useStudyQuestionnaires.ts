/**
 * Hook for fetching study questionnaires
 * 
 * Provides access to questionnaires configured for a specific study.
 * Uses get_study_questionnaires RPC which returns localized data.
 */

import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { usePermissions } from "@/hooks/usePermissions";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { parseRpcArray } from "@/lib/validation/rpcSchemas";
import { translationMapEntrySchema } from "@/lib/validation/rpcSchemas";
import { getTranslationLocale } from "@/lib/i18n/locale";

const studyQuestionnaireRpcSchema = z.object({
  id: z.string().uuid(),
  study_id: z.string().uuid(),
  title_key: z.string().nullable(),
  description_key: z.string().nullable(),
  display_order: z.number(),
  is_required: z.boolean(),
});

type StudyQuestionnaireRpc = z.infer<typeof studyQuestionnaireRpcSchema>;

// Schema for study questionnaire (public-facing, already localized)
export const studyQuestionnaireSchema = z.object({
  id: z.string().uuid(),
  study_id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  display_order: z.number(),
  is_required: z.boolean(),
  token_reward: z.number().nullable().optional(),
});

export type StudyQuestionnaire = z.infer<typeof studyQuestionnaireSchema>;

// Schema for questionnaire selection (simpler for dropdowns)
export const questionnaireOptionSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  is_required: z.boolean(),
  token_reward: z.number().nullable(),
});

export type QuestionnaireOption = z.infer<typeof questionnaireOptionSchema>;

type TranslationMap = Record<string, string>;

function collectQuestionnaireTranslationKeys(rows: StudyQuestionnaireRpc[]): string[] {
  const keys = new Set<string>();
  rows.forEach((row) => {
    if (row.title_key) keys.add(row.title_key);
    if (row.description_key) keys.add(row.description_key);
  });
  return Array.from(keys);
}

async function fetchQuestionnaireTranslations(
  keys: string[],
  locale: string
): Promise<TranslationMap> {
  if (keys.length === 0) return {};

  const { data, error } = await aisha.rpc("get_translations_map_with_fallback", {
    p_fallback_locale: "en",
    p_keys: keys,
    p_locale: locale,
    p_namespace: "questionnaires",
  });

  if (error) throw new Error(error.message);

  return parseRpcArray(
    translationMapEntrySchema,
    data,
    "get_translations_map_with_fallback"
  ).reduce<TranslationMap>((acc, entry) => {
    acc[entry.key] = entry.value;
    return acc;
  }, {});
}

function mapStudyQuestionnaireRow(
  row: StudyQuestionnaireRpc,
  translations: TranslationMap
): StudyQuestionnaire {
  return {
    id: row.id,
    study_id: row.study_id,
    title: row.title_key ? (translations[row.title_key] ?? row.title_key) : row.id,
    description: row.description_key ? (translations[row.description_key] ?? row.description_key) : "",
    display_order: row.display_order,
    is_required: row.is_required,
    token_reward: null,
  };
}

/**
 * Fetch questionnaires for a specific study (public/localized)
 */
export function useStudyQuestionnaires(studyId: string | null | undefined) {
  const { i18n } = useTranslation();
  const locale = getTranslationLocale(i18n.language);

  return useQuery({
    queryKey: ["study-questionnaires", studyId, locale],
    queryFn: async () => {
      if (!studyId) return [];
      
      const { data, error } = await aisha.rpc("get_study_questionnaires", {
        p_study_id: studyId,
      });
      
      if (error) throw new Error(error.message);
      const rows = parseRpcArray(
        studyQuestionnaireRpcSchema,
        data,
        "get_study_questionnaires"
      );
      const translations = await fetchQuestionnaireTranslations(
        collectQuestionnaireTranslationKeys(rows),
        locale
      );
      return rows.map((row) => mapStudyQuestionnaireRow(row, translations));
    },
    enabled: Boolean(studyId),
  });
}

/**
 * Get available questionnaires for partner's assigned studies
 * Returns deduplicated list of questionnaires across all studies partner consults on
 */
export function usePartnerAvailableQuestionnaires(studyIds: string[]) {
  const { i18n } = useTranslation();
  const locale = getTranslationLocale(i18n.language);

  return useQuery({
    queryKey: ["partner-available-questionnaires", studyIds, locale],
    queryFn: async () => {
      if (studyIds.length === 0) return [];
      
      // Fetch questionnaires for all studies
      const results = await Promise.all(
        studyIds.map(async (studyId) => {
          const { data, error } = await aisha.rpc("get_study_questionnaires", {
            p_study_id: studyId,
          });
          if (error) return [];
          const rows = parseRpcArray(
            studyQuestionnaireRpcSchema,
            data,
            "get_study_questionnaires"
          );
          return rows;
        })
      );
      
      // Flatten and deduplicate by id
      const allQuestionnaires = results.flat();
      const translations = await fetchQuestionnaireTranslations(
        collectQuestionnaireTranslationKeys(allQuestionnaires),
        locale
      );

      const seen = new Set<string>();
      return allQuestionnaires
        .map((row) => mapStudyQuestionnaireRow(row, translations))
        .filter((q) => {
        if (seen.has(q.id)) return false;
        seen.add(q.id);
        return true;
      });
    },
    enabled: studyIds.length > 0,
  });
}

/**
 * Fetch all active questionnaires (for admin/internal use)
 * Uses RPC-only pattern for security.
 */
export function useAllQuestionnaires() {
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["all-questionnaires"],
    queryFn: async (): Promise<QuestionnaireOption[]> => {
      if (!isAdmin) return [];
      const { data, error } = await aisha.rpc("get_all_questionnaires_admin");

      if (error) throw new Error(error.message);

      return (data || []).map((q) => ({
        id: q.id,
        key: q.code,
        name: q.name,
        description: q.description_key,
        is_required: false,
        token_reward: q.token_reward,
      }));
    },
    enabled: isAdmin,
  });
}
