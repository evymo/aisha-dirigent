import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useTranslation } from "react-i18next";
import { safeError } from "@/lib/security/safeLogger";
import { safeValidateBlockConfig, type BlockConfig } from "@/schemas/questionBlockSchemas";
import { z } from "zod";

/**
 * Schema for question block from new RPC with translations.
 */
const questionBlockContextSchema = z.object({
  id: z.string().uuid(),
  block_code: z.string(),
  question_type: z.string(),
  text_key: z.string(),
  config: z.unknown(),
  is_required: z.boolean(),
  is_active: z.boolean(),
  display_order: z.number(),
  translated_text: z.string().nullable(),
  translated_description: z.string().nullable(),
  option_translations: z.record(z.string()).nullable().optional(),
});

/**
 * Map of translation keys to translated values.
 * Used for dynamic option label translations from DB.
 */
export type OptionTranslations = Record<string, string>;

/**
 * Validated question block with parsed config and translations.
 */
export interface ValidatedQuestionBlock {
  id: string;
  block_code: string;
  question_type: string;
  text_key: string;
  translatedText: string;
  translatedDescription: string;
  config: BlockConfig | null;
  rawConfig: unknown;
  is_required: boolean;
  is_active: boolean;
  display_order: number;
  /** Map of label_key -> translated value for option labels */
  optionTranslations: OptionTranslations;
}

/**
 * Hook to fetch question blocks by codes with translations.
 */
export function useQuestionBlocks(codes: string[], options?: { enabled?: boolean }) {
  const { i18n } = useTranslation();
  const locale = i18n.language || "en";

  return useQuery({
    queryKey: ["question-blocks", codes.sort().join(","), locale],
    queryFn: async (): Promise<ValidatedQuestionBlock[]> => {
      if (codes.length === 0) return [];

      const { data, error } = await aisha.rpc("get_question_blocks_for_context", {
        p_block_codes: codes,
        p_locale: locale,
      });

      if (error) {
        safeError("useQuestionBlocks.fetch", error);
        throw new Error(error.message);
      }

      const blocks: ValidatedQuestionBlock[] = [];
      const rawBlocks = Array.isArray(data) ? data : [];
      
      for (const raw of rawBlocks) {
        try {
          const parsed = questionBlockContextSchema.parse(raw);
          const validatedConfig = safeValidateBlockConfig(parsed.question_type, parsed.config);
          
          // Parse option_translations from RPC response
          const optionTranslations: OptionTranslations = {};
          if (parsed.option_translations && typeof parsed.option_translations === "object") {
            Object.entries(parsed.option_translations).forEach(([key, value]) => {
              if (typeof value === "string") {
                optionTranslations[key] = value;
              }
            });
          }
          
          blocks.push({
            id: parsed.id,
            block_code: parsed.block_code,
            question_type: parsed.question_type,
            text_key: parsed.text_key,
            translatedText: parsed.translated_text || parsed.text_key,
            translatedDescription: parsed.translated_description || "",
            config: validatedConfig,
            rawConfig: parsed.config,
            is_required: parsed.is_required,
            is_active: parsed.is_active,
            display_order: parsed.display_order,
            optionTranslations,
          });
        } catch (e) {
          safeError("useQuestionBlocks.parseBlock", e);
        }
      }

      return blocks.sort((a, b) => a.display_order - b.display_order);
    },
    enabled: codes.length > 0 && (options?.enabled !== false),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook to fetch a single question block by code.
 */
export function useQuestionBlock(code: string, options?: { enabled?: boolean }) {
  const result = useQuestionBlocks([code], options);
  return { ...result, block: result.data?.[0] ?? null };
}

/**
 * Hook to fetch question blocks for a specific context type.
 *
 * Context types are stored in the `context_type` column on `question_blocks`.
 * The mapping is managed in DB — no hardcoded block codes needed.
 *
 * @param contextType - e.g. "onboarding", "check_in", "registration_basic_info"
 */
export function useQuestionBlocksForContext(contextType: string, options?: { enabled?: boolean }) {
  const { i18n } = useTranslation();
  const locale = i18n.language || "en";

  return useQuery({
    queryKey: ["question-blocks-context", contextType, locale],
    queryFn: async (): Promise<ValidatedQuestionBlock[]> => {
      if (!contextType) return [];

      const { data, error } = await aisha.rpc("get_question_blocks_by_context_type", {
        p_context_type: contextType,
        p_locale: locale,
      });

      if (error) {
        safeError("useQuestionBlocksForContext.fetch", error);
        throw new Error(error.message);
      }

      const blocks: ValidatedQuestionBlock[] = [];
      const rawBlocks = Array.isArray(data) ? data : [];

      for (const raw of rawBlocks) {
        try {
          const parsed = questionBlockContextSchema.parse(raw);
          const validatedConfig = safeValidateBlockConfig(parsed.question_type, parsed.config);

          const optionTranslations: OptionTranslations = {};
          if (parsed.option_translations && typeof parsed.option_translations === "object") {
            Object.entries(parsed.option_translations).forEach(([key, value]) => {
              if (typeof value === "string") {
                optionTranslations[key] = value;
              }
            });
          }

          blocks.push({
            id: parsed.id,
            block_code: parsed.block_code,
            question_type: parsed.question_type,
            text_key: parsed.text_key,
            translatedText: parsed.translated_text || parsed.text_key,
            translatedDescription: parsed.translated_description || "",
            config: validatedConfig,
            rawConfig: parsed.config,
            is_required: parsed.is_required,
            is_active: parsed.is_active,
            display_order: parsed.display_order,
            optionTranslations,
          });
        } catch (e) {
          safeError("useQuestionBlocksForContext.parseBlock", e);
        }
      }

      return blocks.sort((a, b) => a.display_order - b.display_order);
    },
    enabled: !!contextType && (options?.enabled !== false),
    staleTime: 5 * 60 * 1000,
  });
}
