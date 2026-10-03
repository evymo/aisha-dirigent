/**
 * useReminders (mobile) — generic CRUD for reminder DEFINITIONS (the schedules
 * that drive tracked actions). Parity with the web hook src/hooks/useReminders.ts:
 * wraps create_user_reminder / update_user_reminder / deactivate_user_reminder.
 * A reminder is the recurring definition; the events it produces are tracked
 * actions (see useTrackedActions / useRecordTrackedAction).
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/config/api";
import { safeError } from "@/lib/security/safeLogger";

export interface CreateReminderInput {
  title: string;
  reminderType: string;
  frequency: string;
  timeOfDay: string;
  description?: string;
  questionnaireId?: string;
  productId?: string;
  studyRegistrationId?: string;
  customFrequencyDays?: number[];
  daysOfWeek?: number[];
  quickQuestion?: string;
  quickResponseType?: string;
  pointsPerCompletion?: number;
  startDate?: string;
  endDate?: string;
  userTimezone?: string;
}

export interface UpdateReminderInput {
  reminderId: string;
  title?: string;
  description?: string;
  frequency?: string;
  timeOfDay?: string;
  customFrequencyDays?: number[];
  daysOfWeek?: number[];
  quickQuestion?: string;
  quickResponseType?: string;
  pointsPerCompletion?: number;
  endDate?: string;
  userTimezone?: string;
  isActive?: boolean;
}

export const REMINDERS_QUERY_KEY = "reminders";

/** Mutations for reminder definitions, invalidating the reminders cache on success. */
export function useReminders() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [REMINDERS_QUERY_KEY] });
  };

  const create = useMutation({
    mutationFn: async (input: CreateReminderInput): Promise<string> => {
      const { data, error } = await api.rpc("create_user_reminder", {
        p_custom_frequency_days: input.customFrequencyDays,
        p_days_of_week: input.daysOfWeek,
        p_description: input.description,
        p_end_date: input.endDate,
        p_frequency: input.frequency,
        p_points_per_completion: input.pointsPerCompletion,
        p_product_id: input.productId,
        p_questionnaire_id: input.questionnaireId,
        p_quick_question: input.quickQuestion,
        p_quick_response_type: input.quickResponseType,
        p_reminder_type: input.reminderType,
        p_start_date: input.startDate,
        p_study_registration_id: input.studyRegistrationId,
        p_time_of_day: input.timeOfDay,
        p_title: input.title,
        p_user_timezone: input.userTimezone,
      });
      if (error) {
        safeError("useReminders.create", error);
        throw new Error(error.message);
      }
      return data as string;
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async (input: UpdateReminderInput): Promise<boolean> => {
      const { data, error } = await api.rpc("update_user_reminder", {
        p_custom_frequency_days: input.customFrequencyDays,
        p_days_of_week: input.daysOfWeek,
        p_description: input.description,
        p_end_date: input.endDate,
        p_frequency: input.frequency,
        p_is_active: input.isActive,
        p_points_per_completion: input.pointsPerCompletion,
        p_quick_question: input.quickQuestion,
        p_quick_response_type: input.quickResponseType,
        p_reminder_id: input.reminderId,
        p_time_of_day: input.timeOfDay,
        p_title: input.title,
        p_user_timezone: input.userTimezone,
      });
      if (error) {
        safeError("useReminders.update", error);
        throw new Error(error.message);
      }
      return data as boolean;
    },
    onSuccess: invalidate,
  });

  const deactivate = useMutation({
    mutationFn: async (reminderId: string): Promise<boolean> => {
      const { data, error } = await api.rpc("deactivate_user_reminder", {
        p_reminder_id: reminderId,
      });
      if (error) {
        safeError("useReminders.deactivate", error);
        throw new Error(error.message);
      }
      return data as boolean;
    },
    onSuccess: invalidate,
  });

  return { create, update, deactivate };
}
