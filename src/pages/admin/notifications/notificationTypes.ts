import type { SupportedLocale } from "@/hooks/useDynamicTranslations";

export type LocalizedText = Partial<Record<SupportedLocale, string>>;

export type AudienceType = "all" | "study" | "questionnaire_due" | "user_list";

export interface CampaignFormData {
  audience_type: AudienceType;
  base_locale: SupportedLocale;
  body: LocalizedText;
  data_json: string;
  description: string;
  is_active: boolean;
  link: string;
  name: string;
  questionnaire_frequencies: string[];
  send_inapp: boolean;
  send_push: boolean;
  study_id: string;
  title: LocalizedText;
  user_ids: string;
}

export interface ScheduleFormData {
  custom_minutes: string;
  repeat: "once" | "daily" | "weekly" | "monthly" | "custom";
  run_at: string;
  status: "scheduled" | "paused";
}

export const FREQUENCY_OPTIONS = ["daily", "weekly", "monthly", "entry"] as const;

export const EMPTY_SCHEDULE_FORM: ScheduleFormData = {
  custom_minutes: "",
  repeat: "once",
  run_at: "",
  status: "scheduled",
};

export const createEmptyLocalized = (
  locales: SupportedLocale[],
  fallback = ""
): LocalizedText =>
  locales.reduce<LocalizedText>((acc, locale) => {
    acc[locale] = fallback;
    return acc;
  }, {});

export const ensureLocales = (
  values: LocalizedText,
  locales: SupportedLocale[]
): LocalizedText => {
  const next = { ...values };
  locales.forEach((locale) => {
    if (next[locale] === undefined) next[locale] = "";
  });
  return next;
};

export const safeParseJson = (raw: string): Record<string, unknown> | null => {
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

export const toLocalDateTimeInput = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMinutes = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offsetMinutes * 60_000);
  return local.toISOString().slice(0, 16);
};

export const repeatOptionFromMinutes = (
  minutes: number | null
): ScheduleFormData["repeat"] => {
  if (!minutes) return "once";
  if (minutes === 1440) return "daily";
  if (minutes === 10080) return "weekly";
  if (minutes === 43200) return "monthly";
  return "custom";
};

export const resolveRepeatMinutes = (
  repeat: ScheduleFormData["repeat"],
  customMinutes: string
): number | null => {
  switch (repeat) {
    case "daily":
      return 1440;
    case "weekly":
      return 10080;
    case "monthly":
      return 43200;
    case "custom": {
      const minutes = Number(customMinutes);
      return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
    }
    default:
      return null;
  }
};
