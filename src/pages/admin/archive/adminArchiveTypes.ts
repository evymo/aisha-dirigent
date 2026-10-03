import {
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@/hooks/useDynamicTranslations";

export type LocalizedText = Partial<Record<SupportedLocale, string>>;

export const PROVENANCE_BADGES = [
  "original_scan",
  "translated_excerpt",
  "editorial_note",
  "unverified_claim",
] as const;

export const DOCUMENT_TYPES = [
  "operational_report",
  "research_paper",
  "patent",
  "letter",
  "photograph",
  "formula",
  "correspondence",
  "certificate",
  "testimonial",
  "protocol",
] as const;

export const ORIGINAL_LANGUAGES = [
  { value: "cs", labelKey: "admin.archive.languages.cs" },
  { value: "en", labelKey: "admin.archive.languages.en" },
  { value: "de", labelKey: "admin.archive.languages.de" },
  { value: "sk", labelKey: "admin.archive.languages.sk" },
] as const;

export const TRANSLATION_NAMESPACE = "archive";

/** Create an empty localized text record for all supported locales. */
export const createEmptyLocalized = (): LocalizedText =>
  SUPPORTED_LOCALES.reduce<LocalizedText>((acc, locale) => {
    acc[locale] = "";
    return acc;
  }, {});

/** Form data for creating/editing archive documents with inline translations. */
export interface ArchiveFormData {
  slug: string;
  // Localized fields
  title: LocalizedText;
  description: LocalizedText;
  summary: LocalizedText;
  editorial_note: LocalizedText;
  what_you_are_looking_at: LocalizedText;
  standards_context: LocalizedText;
  // Non-localized fields
  content: string;
  document_type: string;
  provenance_badge: string;
  year: string;
  decade: string;
  facility: string;
  place: string;
  preparation: string;
  scan_url: string;
  transcript_url: string;
  source_publication: string;
  original_language: string;
  page_count: string;
  is_featured: boolean;
  is_download_public: boolean;
  people: string[];
  keywords: string[];
}

export const initialArchiveFormData: ArchiveFormData = {
  slug: "",
  title: createEmptyLocalized(),
  description: createEmptyLocalized(),
  summary: createEmptyLocalized(),
  editorial_note: createEmptyLocalized(),
  what_you_are_looking_at: createEmptyLocalized(),
  standards_context: createEmptyLocalized(),
  content: "",
  document_type: "operational_report",
  provenance_badge: "original_scan",
  year: "",
  decade: "",
  facility: "",
  place: "",
  preparation: "",
  scan_url: "",
  transcript_url: "",
  source_publication: "",
  original_language: "en",
  page_count: "",
  is_featured: false,
  is_download_public: false,
  people: [],
  keywords: [],
};
