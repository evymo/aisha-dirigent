/**
 * Hook pro dynamické načítání registration dotazníku studie.
 *
 * Místo hardcoded STUDY_ENROLLMENT_QUESTIONNAIRE_ID tento hook dynamicky
 * načítá registrační dotazník pro danou studii z DB pomocí RPC.
 *
 * @module hooks/useStudyRegistrationQuestionnaire
 */

import { useQuery } from "@tanstack/react-query";
import { getTranslationLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { aisha } from "@/integrations/db/client";
import { parseRpcArray } from "@/lib/validation/rpcSchemas";

// Schema pro výstup z RPC get_study_registration_questionnaire
const studyRegistrationQuestionnaireSchema = z.object({
  questionnaire_id: z.string().uuid(),
  questionnaire_code: z.string(),
  questionnaire_title: z.string(),
  questionnaire_description: z.string(),
  is_required: z.boolean(),
  token_reward: z.number().nullable(),
});

export type StudyRegistrationQuestionnaire = z.infer<typeof studyRegistrationQuestionnaireSchema>;

// Schema pro questionnaire block z get_questionnaire_blocks_localized
const questionBlockSchema = z.object({
  id: z.string().uuid(),
  block_code: z.string(),
  question_type: z.string(),
  translated_text: z.string().nullable(),
  translated_description: z.string().nullable(),
  config: z.record(z.unknown()).nullable(),
  is_required: z.boolean(),
  display_order: z.number(),
  step_number: z.number().nullable(),
  section_key: z.string().nullable(),
  option_translations: z.record(z.string()).nullable(),
});

export type QuestionBlock = z.infer<typeof questionBlockSchema>;

// Seskupení bloků do kroků
export interface QuestionnaireStep {
  step_number: number;
  section_key: string | null;
  blocks: QuestionBlock[];
}

/**
 * Hook pro načtení registračního dotazníku studie.
 *
 * @param studyId - UUID studie pro kterou načíst dotazník
 * @returns Objekt s informacemi o dotazníku (ID, kód, název) a loading stav
 *
 * @example
 * const { questionnaire, isLoading } = useStudyRegistrationQuestionnaire(studyId);
 * if (questionnaire) {
 *   console.log(questionnaire.questionnaire_code);
 * }
 */
export function useStudyRegistrationQuestionnaire(studyId: string | null | undefined) {
  const { i18n } = useTranslation();
  const locale = getTranslationLocale(i18n.language);

  return useQuery({
    queryKey: ["study-registration-questionnaire", studyId, locale],
    queryFn: async () => {
      if (!studyId) return null;

      const { data, error } = await aisha.rpc("get_study_registration_questionnaire", {
        p_locale: locale
,
        p_study_id: studyId
    });

      if (error) throw new Error(error.message);

      // RPC vrací array, bereme první položku
      const parsed = parseRpcArray(studyRegistrationQuestionnaireSchema, data, "get_study_registration_questionnaire");
      return parsed.length > 0 ? parsed[0] : null;
    },
    enabled: Boolean(studyId),
    staleTime: 10 * 60 * 1000, // 10 minut cache
  });
}

/**
 * Hook pro načtení bloků (otázek) dotazníku s překlady.
 *
 * Používá get_questionnaire_blocks_localized RPC.
 *
 * @param questionnaireCode - Kód dotazníku (např. 'study-registration')
 * @returns Objekt s bloky otázek seskupenými do kroků
 *
 * @example
 * const { steps, blocks, isLoading } = useQuestionnaireBlocksLocalized('study-registration');
 */
export function useQuestionnaireBlocksLocalized(questionnaireCode: string | null | undefined) {
  const { i18n } = useTranslation();
  const locale = getTranslationLocale(i18n.language);

  const query = useQuery({
    queryKey: ["questionnaire-blocks-localized", questionnaireCode, locale],
    queryFn: async () => {
      if (!questionnaireCode) return [];

      const { data, error } = await aisha.rpc("get_questionnaire_blocks_localized", {
        p_locale: locale
,
        p_questionnaire_code: questionnaireCode
    });

      if (error) throw new Error(error.message);
      return parseRpcArray(questionBlockSchema, data, "get_questionnaire_blocks_localized");
    },
    enabled: Boolean(questionnaireCode),
    staleTime: 10 * 60 * 1000, // 10 minut - bloky se moc nemění
  });

  // Seskupení bloků do kroků
  const steps: QuestionnaireStep[] = [];
  const blocks = query.data ?? [];

  if (blocks.length > 0) {
    const stepMap = new Map<number, QuestionnaireStep>();

    blocks.forEach((block) => {
      const stepNum = block.step_number ?? 1;

      if (!stepMap.has(stepNum)) {
        stepMap.set(stepNum, {
          step_number: stepNum,
          section_key: block.section_key,
          blocks: [],
        });
      }

      stepMap.get(stepNum)!.blocks.push(block);
    });

    // Seřazení kroků
    steps.push(...Array.from(stepMap.values()).sort((a, b) => a.step_number - b.step_number));
  }

  return {
    blocks,
    steps,
    totalSteps: steps.length,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Kombinovaný hook pro načtení dotazníku studie včetně jeho bloků.
 *
 * Nejprve načte info o dotazníku pro studii, pak načte bloky s překlady.
 *
 * @param studyId - UUID studie
 * @returns Kompletní data pro vykreslení dynamického dotazníku
 *
 * @example
 * const { questionnaire, steps, isLoading } = useStudyRegistrationQuestionnaireWithBlocks(studyId);
 */
export function useStudyRegistrationQuestionnaireWithBlocks(studyId: string | null | undefined) {
  const questionnaireQuery = useStudyRegistrationQuestionnaire(studyId);
  const questionnaire = questionnaireQuery.data;

  const blocksQuery = useQuestionnaireBlocksLocalized(questionnaire?.questionnaire_code);

  return {
    questionnaire,
    questionnaireId: questionnaire?.questionnaire_id ?? null,
    questionnaireCode: questionnaire?.questionnaire_code ?? null,
    blocks: blocksQuery.blocks,
    steps: blocksQuery.steps,
    totalSteps: blocksQuery.totalSteps,
    isLoading: questionnaireQuery.isLoading || blocksQuery.isLoading,
    error: questionnaireQuery.error || blocksQuery.error,
  };
}
