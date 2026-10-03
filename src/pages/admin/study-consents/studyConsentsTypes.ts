/**
 * Shared types, constants, and helpers for AdminStudyConsents.
 * @module studyConsentsTypes
 */

import type { SupportedLocale } from "@/hooks/useDynamicTranslations";
import { SUPPORTED_LOCALES } from "@/hooks/useDynamicTranslations";

// Translation namespaces
export const CONSENT_NAMESPACE = "consents";
export const QUESTIONNAIRE_NAMESPACE = "questionnaires";

/** Create an empty locale record with all supported locales. */
export const emptyLocaleRecord = (): Record<SupportedLocale, string> =>
  Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l, ""])) as Record<SupportedLocale, string>;

/** Sanitize a value into a URL/key-safe snake_case segment. */
export const sanitizeKeySegment = (value: string): string => {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "item";
};

/** Build translation keys for a consent template. */
export const buildConsentTemplateKeys = (templateKey: string) => {
  const segment = sanitizeKeySegment(templateKey);
  return {
    titleKey: `${segment}.title`,
    descriptionKey: `${segment}.description`,
    checkboxLabelKey: `${segment}.checkbox`,
  };
};

/** Build translation keys for a study questionnaire. */
export const buildStudyQuestionnaireKeys = (studyCode: string, questionnaireType: string) => {
  const studySegment = sanitizeKeySegment(studyCode);
  const typeSegment = sanitizeKeySegment(questionnaireType);
  return {
    titleKey: `${studySegment}.${typeSegment}.title`,
    descriptionKey: `${studySegment}.${typeSegment}.description`,
  };
};

/** Form state for editing a consent template (with multilingual fields). */
export interface ConsentTemplateForm {
  id?: string;
  template_key: string;
  title: Record<SupportedLocale, string>;
  content: Record<SupportedLocale, string>;
  version: string;
  requires_signature: boolean;
  is_active: boolean;
}

/** Form state for editing a study consent requirement. */
export interface StudyConsentRequirementForm {
  consent_template_id: string;
  is_required: boolean;
  sort_order: number;
}

/** Form state for editing a study questionnaire. */
export interface StudyQuestionnaireForm {
  id?: string;
  questionnaire_id: string;
  questionnaire_type: string;
  title: Record<SupportedLocale, string>;
  description: Record<SupportedLocale, string>;
  is_required: boolean;
  is_active: boolean;
  frequency_type: string;
  frequency_days: number | null;
  token_reward: number;
  display_order: number;
  starts_after_days: number;
  ends_after_days: number | null;
}
