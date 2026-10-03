/**
 * Hook for fetching member's pending questionnaires
 *
 * Returns questionnaires from user's enrolled studies (including pending registration).
 * Uses get_study_questionnaires_mobile RPC which handles:
 * - Registration status filtering (pending, screening, enrolled, active)
 * - Completion status tracking
 * - Localized titles/descriptions
 * - Rate limiting and audit logging
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getTranslationLocale } from "@/lib/i18n/locale";
import { z } from "zod";
import { aisha } from "@/integrations/db/client";
import { useSession } from "@/hooks/useSession";
import { safeError } from "@/lib/security/safeLogger";

// Schema matching RPC response
const questionnaireItemSchema = z.object({
  registration_id: z.string().uuid(),
  study_id: z.string().uuid(),
  study_name: z.string(),
  study_questionnaire_id: z.string().uuid(),
  questionnaire_id: z.string().uuid(),
  questionnaire_code: z.string(),
  questionnaire_type: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  display_order: z.number(),
  is_required: z.boolean(),
  frequency_type: z.string().nullable(),
  frequency_days: z.number().nullable(),
  starts_after_days: z.number().nullable(),
  ends_after_days: z.number().nullable(),
  points_reward: z.number(),
  status: z.enum(["pending", "completed", "expired", "not_started"]),
  last_completed_at: z.string().nullable(),
  next_available_at: z.string().nullable(),
  deadline_at: z.string().nullable(),
});

const responseSchema = z.object({
  questionnaires: z.array(questionnaireItemSchema),
  total_pending: z.number(),
  total_completed: z.number(),
});

export type MyQuestionnaire = z.infer<typeof questionnaireItemSchema>;

/**
 * Fetch questionnaires for current user's enrolled studies
 *
 * @param studyRegistrationId - Optional filter by specific registration
 */
export function useMyQuestionnaires(studyRegistrationId?: string) {
  const { user } = useSession();
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  const locale = getTranslationLocale(i18n.language);

  const query = useQuery({
    queryKey: ["my-questionnaires", user?.id, studyRegistrationId, locale],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_study_questionnaires_mobile", {
        p_locale: locale,
        p_study_registration_id: studyRegistrationId ?? undefined,
      });

      if (error) {
        safeError("useMyQuestionnaires.fetch", error);
        throw new Error(error.message);
      }

      // Parse response
      const parsed = responseSchema.safeParse(data);
      if (!parsed.success) {
        safeError("useMyQuestionnaires.parse", parsed.error);
        // Return empty if parse fails
        return { questionnaires: [], total_pending: 0, total_completed: 0 };
      }

      return parsed.data;
    },
    enabled: !!user?.id,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });

  // Computed values
  const questionnaires = query.data?.questionnaires ?? [];
  const pendingQuestionnaires = questionnaires.filter((q) => q.status === "pending");
  const completedQuestionnaires = questionnaires.filter((q) => q.status === "completed");
  const expiredQuestionnaires = questionnaires.filter((q) => q.status === "expired");

  // Group by study for display
  const questionnairesByStudy = questionnaires.reduce(
    (acc, q) => {
      if (!acc[q.study_id]) {
        acc[q.study_id] = {
          study_name: q.study_name,
          questionnaires: [],
        };
      }
      acc[q.study_id].questionnaires.push(q);
      return acc;
    },
    {} as Record<string, { study_name: string; questionnaires: MyQuestionnaire[] }>
  );

  return {
    // Raw data
    questionnaires,
    pendingQuestionnaires,
    completedQuestionnaires,
    expiredQuestionnaires,
    questionnairesByStudy,

    // Counts
    totalPending: query.data?.total_pending ?? 0,
    totalCompleted: query.data?.total_completed ?? 0,

    // Query state
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    invalidate: () =>
      queryClient.invalidateQueries({ queryKey: ["my-questionnaires"] }),
  };
}
