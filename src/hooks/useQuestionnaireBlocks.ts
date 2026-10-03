import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { safeWarn, safeError } from "@/lib/security/safeLogger";
import { safeValidateBlockConfig, type BlockConfig } from "@/schemas/questionBlockSchemas";
import { parseRpcArray, questionnaireBlockLocalizedSchema } from "@/lib/validation/rpcSchemas";
import { aisha } from "@/integrations/db/client";
import { getI18nPrimaryLocale } from "@/lib/i18n/locale";

/**
 * Schema for validating questionnaire block data from RPC
 */
export type QuestionnaireBlockRaw = {
  id: string;
  block_code: string;
  question_type: string;
  translated_text: string | null;
  translated_description: string | null;
  config: Record<string, unknown> | null;
  is_required: boolean;
  display_order: number;
  step_number: number | null;
  section_key: string | null;
  option_translations: Record<string, string> | null;
};

/**
 * Validated block with parsed configuration - compatible with QuestionBlockRenderer
 */
export interface ValidatedQuestionnaireBlock {
  id: string;
  block_code: string;
  question_type: string;
  text_key: string; // For compatibility with QuestionBlockRenderer
  translatedText: string;
  translatedDescription: string;
  config: BlockConfig | null;
  rawConfig: Record<string, unknown>;
  is_required: boolean;
  is_active: boolean;
  display_order: number;
  stepNumber: number;
  sectionKey: string | null;
  optionTranslations: Record<string, string>;
}

/**
 * Hook to fetch localized questionnaire blocks by questionnaire code
 * Uses the get_questionnaire_blocks_localized RPC
 */
export function useQuestionnaireBlocks(
  questionnaireCode: string,
  options?: { enabled?: boolean }
) {
  const { i18n } = useTranslation();
  const locale = getI18nPrimaryLocale(i18n.language);

  return useQuery({
    queryKey: ["questionnaire-blocks", questionnaireCode, locale],
    queryFn: async (): Promise<ValidatedQuestionnaireBlock[]> => {
      const { data, error } = await aisha.rpc("get_questionnaire_blocks_localized", {
        p_locale: locale,
        p_questionnaire_code: questionnaireCode,
      });

      if (error) {
        safeError("useQuestionnaireBlocks.rpcError", `questionnaire=${questionnaireCode}`);
        throw new Error(error.message);
      }
      
      const parsed = parseRpcArray(
        questionnaireBlockLocalizedSchema,
        data,
        "get_questionnaire_blocks_localized"
      );

      if (parsed.length === 0) {
        safeWarn("useQuestionnaireBlocks.noBlocks", `questionnaire=${questionnaireCode}`);
        return [];
      }

      const validated: ValidatedQuestionnaireBlock[] = [];

      for (const block of parsed) {
        const rawConfig = (block.config as Record<string, unknown> | null) || {};
        const validatedConfig = safeValidateBlockConfig(block.question_type, rawConfig);

        validated.push({
          id: block.id,
          block_code: block.block_code,
          question_type: block.question_type,
          text_key: `questionnaires.blocks.${block.block_code}.text`,
          translatedText: block.translated_text || block.block_code,
          translatedDescription: block.translated_description || "",
          config: validatedConfig,
          rawConfig,
          is_required: block.is_required,
          is_active: true,
          display_order: block.display_order ?? 0,
          stepNumber: block.step_number ?? 1,
          sectionKey: block.section_key,
          optionTranslations: block.option_translations || {},
        });
      }

      // RPC already returns blocks ordered by step_number, display_order
      // DO NOT re-sort here - it would break multi-step questionnaire ordering
      return validated;
    },
    enabled: options?.enabled !== false && Boolean(questionnaireCode),
    staleTime: 5 * 60 * 1000, // 5 minutes cache
  });
}

/**
 * Group blocks by step number for multi-step questionnaires.
 * Sorts blocks within each step by display_order for consistent rendering.
 * Note: RPC already returns ordered data, but this ensures correct order
 * even if blocks are filtered or modified before grouping.
 */
export function groupBlocksByStep(
  blocks: ValidatedQuestionnaireBlock[]
): Map<number, ValidatedQuestionnaireBlock[]> {
  const grouped = new Map<number, ValidatedQuestionnaireBlock[]>();

  for (const block of blocks) {
    const step = block.stepNumber;
    if (!grouped.has(step)) {
      grouped.set(step, []);
    }
    grouped.get(step)!.push(block);
  }

  // Sort blocks within each step by display order
  for (const [step, stepBlocks] of grouped) {
    grouped.set(
      step,
      stepBlocks.sort((a, b) => a.display_order - b.display_order)
    );
  }

  return grouped;
}

/**
 * Get unique step numbers sorted
 */
export function getStepNumbers(blocks: ValidatedQuestionnaireBlock[]): number[] {
  const steps = new Set(blocks.map((b) => b.stepNumber));
  return Array.from(steps).sort((a, b) => a - b);
}

/**
 * Group blocks by section key
 */
export function groupBlocksBySection(
  blocks: ValidatedQuestionnaireBlock[]
): Map<string | null, ValidatedQuestionnaireBlock[]> {
  const grouped = new Map<string | null, ValidatedQuestionnaireBlock[]>();

  for (const block of blocks) {
    const section = block.sectionKey;
    if (!grouped.has(section)) {
      grouped.set(section, []);
    }
    grouped.get(section)!.push(block);
  }

  return grouped;
}
