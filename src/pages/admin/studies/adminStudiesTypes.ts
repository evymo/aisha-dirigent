import type { SupportedLocale } from "@/hooks/useDynamicTranslations";

export const TRANSLATION_NAMESPACE = "studies";

export interface StudyFormData {
  code: string;
  name: Record<SupportedLocale, string>;
  description: Record<SupportedLocale, string>;
  study_type: import("@/hooks").StudyType;
  target_condition: string;
  is_active: boolean;
  is_umbrella: boolean;
  starts_at: string;
  ends_at: string;
  protocol_url: string;
  products: string;
  duration_weeks: number | null;
  target_registration: number | null;
  min_participants: number;
  max_participants: number | null;
  funding_goal: number;
  funding_deadline: string;
  is_blinded: boolean;
  informed_consent_version: string;
  informed_consent_special_provisions: string;
  base_locale: SupportedLocale;
}

export const defaultFormData: StudyFormData = {
  code: "",
  name: { en: "", cs: "", de: "", fr: "", ru: "", th: "" },
  description: { en: "", cs: "", de: "", fr: "", ru: "", th: "" },
  study_type: "observational",
  target_condition: "",
  is_active: true,
  is_umbrella: false,
  starts_at: "",
  ends_at: "",
  protocol_url: "",
  products: "",
  duration_weeks: null,
  target_registration: null,
  min_participants: 0,
  max_participants: null,
  funding_goal: 0,
  funding_deadline: "",
  is_blinded: false,
  informed_consent_version: "1.0",
  informed_consent_special_provisions: "",
  base_locale: "en",
};

export function toDateTimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDateTimeLocalValue(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function parseProductsInput(value: string): string[] | undefined {
  const products = value
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);
  return products.length > 0 ? products : undefined;
}
