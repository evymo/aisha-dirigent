import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { useSession } from "./useSession";

export const NOTIFICATION_PREFERENCES_QUERY_KEY = ["notification-preferences"] as const;

const notificationReminderPeriodSchema = z.enum(["morning", "afternoon", "evening"]);

const notificationPreferencesRpcSchema = z.object({
  push_enabled: z.boolean().optional(),
  push_reminders: z.boolean().optional(),
  push_health_insights: z.boolean().optional(),
  push_leaderboard: z.boolean().optional(),
  push_study_updates: z.boolean().optional(),
  push_achievements: z.boolean().optional(),
  quiet_hours_enabled: z.boolean().optional(),
  quiet_hours_start: z.string().nullable().optional(),
  quiet_hours_end: z.string().nullable().optional(),
  morning_start: z.string().nullable().optional(),
  afternoon_start: z.string().nullable().optional(),
  evening_start: z.string().nullable().optional(),
  questionnaire_reminder_period: notificationReminderPeriodSchema.optional(),
  user_timezone: z.string().nullable().optional(),
  email_weekly_summary: z.boolean().optional(),
  email_monthly_report: z.boolean().optional(),
  email_study_invitations: z.boolean().optional(),
  max_daily_push_notifications: z.number().int().optional(),
  min_notification_interval_minutes: z.number().int().optional(),
});

export type NotificationReminderPeriod = z.infer<typeof notificationReminderPeriodSchema>;

export interface UserNotificationPreferences {
  push_enabled: boolean;
  push_reminders: boolean;
  push_health_insights: boolean;
  push_leaderboard: boolean;
  push_study_updates: boolean;
  push_achievements: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  morning_start: string;
  afternoon_start: string;
  evening_start: string;
  questionnaire_reminder_period: NotificationReminderPeriod;
  user_timezone: string;
  email_weekly_summary: boolean;
  email_monthly_report: boolean;
  email_study_invitations: boolean;
  max_daily_push_notifications: number;
  min_notification_interval_minutes: number;
}

/**
 * Partial patch for updating user notification preferences.
 */
export type UserNotificationPreferencesPatch = Partial<UserNotificationPreferences>;

const getBrowserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

const normalizeTime = (value: string | null | undefined, fallback: string): string => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, 5);
};

export const DEFAULT_NOTIFICATION_PREFERENCES: UserNotificationPreferences = {
  push_enabled: true,
  push_reminders: true,
  push_health_insights: true,
  push_leaderboard: false,
  push_study_updates: true,
  push_achievements: true,
  quiet_hours_enabled: false,
  quiet_hours_start: "22:00",
  quiet_hours_end: "07:00",
  morning_start: "09:00",
  afternoon_start: "14:00",
  evening_start: "20:00",
  questionnaire_reminder_period: "morning",
  user_timezone: getBrowserTimezone(),
  email_weekly_summary: true,
  email_monthly_report: true,
  email_study_invitations: true,
  max_daily_push_notifications: 10,
  min_notification_interval_minutes: 30,
};

const normalizePreferences = (input: unknown): UserNotificationPreferences => {
  const parsed = notificationPreferencesRpcSchema.safeParse(input);
  if (!parsed.success) {
    safeError("useNotificationPreferences.parse", parsed.error);
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }

  const prefs = parsed.data;
  return {
    push_enabled: prefs.push_enabled ?? DEFAULT_NOTIFICATION_PREFERENCES.push_enabled,
    push_reminders: prefs.push_reminders ?? DEFAULT_NOTIFICATION_PREFERENCES.push_reminders,
    push_health_insights:
      prefs.push_health_insights ?? DEFAULT_NOTIFICATION_PREFERENCES.push_health_insights,
    push_leaderboard: prefs.push_leaderboard ?? DEFAULT_NOTIFICATION_PREFERENCES.push_leaderboard,
    push_study_updates:
      prefs.push_study_updates ?? DEFAULT_NOTIFICATION_PREFERENCES.push_study_updates,
    push_achievements: prefs.push_achievements ?? DEFAULT_NOTIFICATION_PREFERENCES.push_achievements,
    quiet_hours_enabled:
      prefs.quiet_hours_enabled ?? DEFAULT_NOTIFICATION_PREFERENCES.quiet_hours_enabled,
    quiet_hours_start: normalizeTime(
      prefs.quiet_hours_start,
      DEFAULT_NOTIFICATION_PREFERENCES.quiet_hours_start
    ),
    quiet_hours_end: normalizeTime(
      prefs.quiet_hours_end,
      DEFAULT_NOTIFICATION_PREFERENCES.quiet_hours_end
    ),
    morning_start: normalizeTime(prefs.morning_start, DEFAULT_NOTIFICATION_PREFERENCES.morning_start),
    afternoon_start: normalizeTime(
      prefs.afternoon_start,
      DEFAULT_NOTIFICATION_PREFERENCES.afternoon_start
    ),
    evening_start: normalizeTime(prefs.evening_start, DEFAULT_NOTIFICATION_PREFERENCES.evening_start),
    questionnaire_reminder_period:
      prefs.questionnaire_reminder_period ??
      DEFAULT_NOTIFICATION_PREFERENCES.questionnaire_reminder_period,
    user_timezone: prefs.user_timezone?.trim() || getBrowserTimezone(),
    email_weekly_summary:
      prefs.email_weekly_summary ?? DEFAULT_NOTIFICATION_PREFERENCES.email_weekly_summary,
    email_monthly_report:
      prefs.email_monthly_report ?? DEFAULT_NOTIFICATION_PREFERENCES.email_monthly_report,
    email_study_invitations:
      prefs.email_study_invitations ?? DEFAULT_NOTIFICATION_PREFERENCES.email_study_invitations,
    max_daily_push_notifications:
      prefs.max_daily_push_notifications ??
      DEFAULT_NOTIFICATION_PREFERENCES.max_daily_push_notifications,
    min_notification_interval_minutes:
      prefs.min_notification_interval_minutes ??
      DEFAULT_NOTIFICATION_PREFERENCES.min_notification_interval_minutes,
  };
};

/**
 * Reads and updates notification preferences for the authenticated user.
 */
export function useNotificationPreferences(options?: { enabled?: boolean }) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const enabled = (options?.enabled ?? true) && !!user;

  const query = useQuery({
    queryKey: NOTIFICATION_PREFERENCES_QUERY_KEY,
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<UserNotificationPreferences> => {
      const { data, error } = await aisha.rpc("get_my_notification_preferences");
      if (error) {
        safeError("useNotificationPreferences.fetch", error);
        throw new Error(error.message);
      }
      return normalizePreferences(data);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (patch: UserNotificationPreferencesPatch): Promise<UserNotificationPreferences> => {
      const nextPatch: UserNotificationPreferencesPatch = {
        ...patch,
        user_timezone:
          patch.user_timezone ??
          query.data?.user_timezone ??
          DEFAULT_NOTIFICATION_PREFERENCES.user_timezone,
      };

      const { error } = await aisha.rpc("update_notification_preferences", {
        p_preferences: nextPatch,
      });
      if (error) {
        safeError("useNotificationPreferences.update", error);
        throw new Error(error.message);
      }

      const { data, error: readError } = await aisha.rpc("get_my_notification_preferences");
      if (readError) {
        safeError("useNotificationPreferences.refetch", readError);
        throw readError;
      }

      return normalizePreferences(data);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(NOTIFICATION_PREFERENCES_QUERY_KEY, data);
    },
  });

  return {
    notificationPreferences: query.data ?? DEFAULT_NOTIFICATION_PREFERENCES,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    isUpdating: updateMutation.isPending,
    updateNotificationPreferences: updateMutation.mutateAsync,
    refetch: query.refetch,
  };
}
