import { z } from "zod";
import type { Tables, Json } from "@/integrations/db/types";
import {
  SUPPORTED_LOCALES,
  LOCALE_LABELS,
  type SupportedLocale,
} from "@/hooks/useDynamicTranslations";
import {
  type QuestionnaireExtended,
  questionnaireExtendedSchema,
} from "@/hooks/useAdminQuestionnaires";

// Re-export centralized locale constants for use in sub-components
export { SUPPORTED_LOCALES, LOCALE_LABELS };
export type { SupportedLocale };
export type SupportedLanguage = SupportedLocale;

// Re-export from hook for backward compat
export { questionnaireExtendedSchema };
export type { QuestionnaireExtended };

/**
 * All supported question block types.
 * Must match question_block_types table + mobile/web renderers.
 */
export const QUESTION_TYPES = [
  "text",
  "textarea",
  "number",
  "select",
  "radio",
  "checkbox",
  "scale",
  "date",
  "tags",
  "feeling_preset",
  "boolean",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Human-readable labels for each question type */
export const QUESTION_TYPE_LABELS: Record<QuestionType, { en: string; cs: string }> = {
  text: { en: "Text Input", cs: "Textový vstup" },
  textarea: { en: "Text Area", cs: "Textová oblast" },
  number: { en: "Number", cs: "Číslo" },
  select: { en: "Dropdown", cs: "Výběr" },
  radio: { en: "Radio Buttons", cs: "Přepínače" },
  checkbox: { en: "Checkboxes", cs: "Zaškrtávací pole" },
  scale: { en: "Rating Scale", cs: "Hodnotící škála" },
  date: { en: "Date Input", cs: "Datum" },
  tags: { en: "Tag Selection", cs: "Výběr tagů" },
  feeling_preset: { en: "Feeling Preset", cs: "Preset pocitu" },
  boolean: { en: "Yes/No", cs: "Ano/Ne" },
};

export const TRANSLATION_NAMESPACE = "questionnaires";

// Base questionnaire type from DB
export type QuestionnaireBase = Tables<"questionnaires">;

export type Questionnaire = QuestionnaireBase &
  Partial<Pick<QuestionnaireExtended, "name_key" | "description_key" | "version" | "question_count">> & {
    base_locale?: SupportedLanguage | null;
  };

// Question option schema
export const questionOptionSchema = z.object({
  value: z.string(),
  label: z.union([z.string(), z.record(z.string())]).optional(),
  labelKey: z.string().optional(),
});

// Question DB schema for parsing
export const questionDbSchema = z.object({
  id: z.string().optional(),
  type: z.string(),
  text: z.union([z.string(), z.record(z.string())]).optional(),
  textKey: z.string().optional(),
  description: z.union([z.string(), z.record(z.string())]).optional(),
  descriptionKey: z.string().optional(),
  required: z.boolean().optional(),
  order: z.number().optional(),
  options: z.array(questionOptionSchema).optional(),
  scaleLabels: z.array(questionOptionSchema).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

export const questionsArraySchema = z.array(questionDbSchema);

export interface QuestionOption {
  value: string;
  label: Record<SupportedLanguage, string>;
  labelKey?: string;
}

export interface Question {
  id: string;
  type: QuestionType;
  text: Record<SupportedLanguage, string>;
  textKey?: string;
  description?: Record<SupportedLanguage, string>;
  descriptionKey?: string;
  required?: boolean;
  options?: QuestionOption[];
  scaleLabels?: QuestionOption[];
  min?: number;
  max?: number;
  order: number;
  blockCode?: string;
  blockId?: string;
}

export interface QuestionFormData {
  id: string;
  type: QuestionType;
  text: Record<SupportedLanguage, string>;
  textKey?: string;
  description: Record<SupportedLanguage, string>;
  descriptionKey?: string;
  required: boolean;
  options: QuestionOption[];
  scaleLabels: QuestionOption[];
  min: number;
  max: number;
}

// Question block from RPC
export interface QuestionBlock {
  id: string;
  code: string;
  question_type: string;
  is_required_default: boolean;
  text_key: string;
  description_key: string | null;
  config: Json;
  base_locale: string;
  is_active: boolean;
  sort_order?: number;
  created_at: string;
  updated_at: string;
}

/**
 * Extended block config — stored as JSONB in question_blocks.config.
 * Supports options, scale, scoring, tags, and type-specific settings.
 */
export interface BlockConfig {
  // Options for select/radio/checkbox/tags
  options?: QuestionOption[];
  // Scale config
  scale?: {
    min?: number;
    max?: number;
    labels?: QuestionOption[];
  };
  // Scoring config (for OS-SUBJECTIVE and similar)
  scoring_domain?: string;
  reversed?: boolean;
  section_key?: string;
  // Tags-specific config
  multi_select?: boolean;
  emoji?: string;
  tag_category?: string;
  // Date-specific config
  date_format?: string;
  min_date?: string;
  max_date?: string;
  // Boolean-specific config
  true_label_key?: string;
  false_label_key?: string;
  // Feeling preset config
  preset_count?: number;
}

export interface QuestionBlockFormData {
  id?: string;
  code: string;
  type: QuestionType;
  text: Record<SupportedLanguage, string>;
  description: Record<SupportedLanguage, string>;
  required: boolean;
  options: QuestionOption[];
  scaleLabels: QuestionOption[];
  min: number;
  max: number;
  is_active: boolean;
  // Extended config
  scoring_domain: string;
  reversed: boolean;
  section_key: string;
  multi_select: boolean;
  emoji: string;
  tag_category: string;
  date_format: string;
}

export interface QuestionnaireFormData {
  name: Record<SupportedLanguage, string>;
  code: string;
  description: Record<SupportedLanguage, string>;
  is_active: boolean;
  base_locale: SupportedLanguage;
  questionnaire_type: string;
  points_reward: number;
  token_reward: number;
}

export interface DeleteTarget {
  type: "questionnaire" | "block";
  id: string;
}

// Helper functions
export const emptyLocaleRecord = (): Record<SupportedLanguage, string> =>
  Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l, ""])) as Record<SupportedLanguage, string>;

export const emptyQuestionForm = (): QuestionFormData => ({
  id: `q_${Date.now()}`,
  type: "text",
  text: emptyLocaleRecord(),
  description: emptyLocaleRecord(),
  required: false,
  options: [],
  scaleLabels: [],
  min: 1,
  max: 10,
});

export const emptyBlockForm = (): QuestionBlockFormData => ({
  code: "",
  type: "text",
  text: emptyLocaleRecord(),
  description: emptyLocaleRecord(),
  required: false,
  options: [],
  scaleLabels: [],
  min: 1,
  max: 10,
  is_active: true,
  scoring_domain: "",
  reversed: false,
  section_key: "",
  multi_select: false,
  emoji: "",
  tag_category: "",
  date_format: "DD.MM.YYYY",
});

export const sanitizeKeySegment = (value: string) => {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "item";
};

export const buildKeyPrefix = (code: string, version: number) =>
  `${TRANSLATION_NAMESPACE}.${sanitizeKeySegment(code)}.v${version}`;

export const buildBlockKeyPrefix = (code: string) =>
  `${TRANSLATION_NAMESPACE}.question_blocks.${sanitizeKeySegment(code)}`;

export const toLocaleMap = (value: unknown): Record<SupportedLanguage, string> => {
  const result = emptyLocaleRecord();
  if (value && typeof value === "object") {
    const record = value as Record<string, string>;
    SUPPORTED_LOCALES.forEach((lang) => {
      result[lang] = record[lang] ?? "";
    });
  }
  return result;
};
