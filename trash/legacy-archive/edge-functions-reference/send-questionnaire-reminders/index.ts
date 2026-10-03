// Send Questionnaire Reminder Notifications Edge Function
// Scheduled function to send push notifications for pending questionnaires
// Uses FCM HTTP v1 API with service account authentication

import { serve, createClient } from '../_shared/deps.ts';
import { getFcmAccessToken, getFcmProjectId, isFcmConfigured } from '../_shared/fcm-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface QuestionnaireReminder {
  user_id: string;
  study_registration_id: string;
  questionnaire_id: string;
  questionnaire_code: string;
  questionnaire_title: string;
  frequency: string;
  due_date: string | null;
}

interface NotificationTarget {
  user_id: string;
  fcm_tokens: string[];
  questionnaires: QuestionnaireReminder[];
  dedupe_key: string;
  reminder_period: string;
  local_date: string;
}

interface NotificationPreferences {
  user_id: string;
  push_enabled: boolean | null;
  push_reminders: boolean | null;
  push_study_updates: boolean | null;
  quiet_hours_enabled: boolean | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  morning_start: string | null;
  afternoon_start: string | null;
  evening_start: string | null;
  questionnaire_reminder_period: string | null;
  user_timezone: string | null;
}

const chunk = <T,>(items: T[], size = 500): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const parseTimeToMinutes = (time: string | null | undefined, fallbackMinutes: number): number => {
  if (!time) return fallbackMinutes;
  const [hourRaw, minuteRaw] = time.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return fallbackMinutes;
  return hour * 60 + minute;
};

const getLocalMinutes = (date: Date, timeZone: string): number => {
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return hour * 60 + minute;
  } catch {
    return date.getHours() * 60 + date.getMinutes();
  }
};

const getLocalDateKey = (date: Date, timeZone: string): string => {
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find((p) => p.type === "year")?.value ?? String(date.getUTCFullYear());
    const month = parts.find((p) => p.type === "month")?.value ?? String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = parts.find((p) => p.type === "day")?.value ?? String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  } catch {
    return date.toISOString().split("T")[0];
  }
};

const getLocalCalendarMeta = (
  date: Date,
  timeZone: string
): { localDate: string; dayOfMonth: number; dayOfWeek: number } => {
  const localDate = getLocalDateKey(date, timeZone);
  const [year, month, day] = localDate.split("-").map((value) => Number(value));

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return {
      localDate,
      dayOfMonth: date.getUTCDate(),
      dayOfWeek: date.getUTCDay(),
    };
  }

  return {
    localDate,
    dayOfMonth: day,
    dayOfWeek: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
};

const isWithinRange = (value: number, start: number, end: number): boolean => {
  if (start === end) return true;
  if (start < end) return value >= start && value < end;
  return value >= start || value < end;
};

const getReminderPeriod = (prefs: NotificationPreferences | undefined): "morning" | "afternoon" | "evening" => {
  if (prefs?.questionnaire_reminder_period === "afternoon") return "afternoon";
  if (prefs?.questionnaire_reminder_period === "evening") return "evening";
  return "morning";
};

const isReminderDeliveryEnabled = (prefs: NotificationPreferences | undefined): boolean => {
  if (!prefs) return true;
  if (prefs.push_enabled === false) return false;
  if (prefs.push_reminders === false) return false;
  return true;
};

const buildReminderDedupeKey = (
  userId: string,
  prefs: NotificationPreferences | undefined,
  now: Date
): { key: string; localDate: string; period: "morning" | "afternoon" | "evening" } => {
  const timezone = prefs?.user_timezone || "UTC";
  const localDate = getLocalDateKey(now, timezone);
  const period = getReminderPeriod(prefs);
  return {
    key: `questionnaire_reminder:${userId}:${localDate}:${period}`,
    localDate,
    period,
  };
};

const getNotificationCopy = (
  questionnaires: QuestionnaireReminder[]
): {
  title: string;
  body: string;
  link: string;
  firstQuestionnaire: QuestionnaireReminder;
  count: number;
} => {
  const count = questionnaires.length;
  const firstQuestionnaire = questionnaires[0];
  const title = count === 1
    ? `Nový dotazník: ${firstQuestionnaire.questionnaire_title}`
    : `${count} dotazníků čeká na vyplnění`;
  const body = count === 1
    ? getFrequencyMessage(firstQuestionnaire.frequency)
    : 'Klikněte pro zobrazení všech dotazníků';
  const link = count === 1
    ? `/questionnaires/${firstQuestionnaire.questionnaire_id}`
    : '/questionnaires';

  return {
    title,
    body,
    link,
    firstQuestionnaire,
    count,
  };
};

const buildPushData = (
  copy: ReturnType<typeof getNotificationCopy>,
  dedupeKey: string
): Record<string, string> => {
  const data: Record<string, string> = {
    type: 'questionnaire',
    count: String(copy.count),
    link: copy.link,
    dedupe_key: dedupeKey,
  };

  if (copy.count === 1) {
    data.questionnaire_id = copy.firstQuestionnaire.questionnaire_id;
    data.questionnaire_code = copy.firstQuestionnaire.questionnaire_code;
  }

  return data;
};

const shouldQueueFrequencyForUser = (
  frequency: string,
  prefs: NotificationPreferences | undefined,
  now: Date
): boolean => {
  const timezone = prefs?.user_timezone || "UTC";
  const { dayOfMonth, dayOfWeek } = getLocalCalendarMeta(now, timezone);

  if (frequency === "monthly") {
    return dayOfMonth === 1;
  }

  if (frequency === "weekly" || frequency === "entry") {
    return dayOfWeek === 1;
  }

  return true;
};

const shouldSendNow = (prefs: NotificationPreferences | undefined, now: Date): boolean => {
  if (!prefs) return true;
  if (!isReminderDeliveryEnabled(prefs)) return false;

  const timezone = prefs.user_timezone || "UTC";
  const localMinutes = getLocalMinutes(now, timezone);

  const quietStart = parseTimeToMinutes(prefs.quiet_hours_start, 22 * 60);
  const quietEnd = parseTimeToMinutes(prefs.quiet_hours_end, 7 * 60);
  if (prefs.quiet_hours_enabled && isWithinRange(localMinutes, quietStart, quietEnd)) {
    return false;
  }

  const morning = parseTimeToMinutes(prefs.morning_start, 9 * 60);
  const afternoon = parseTimeToMinutes(prefs.afternoon_start, 14 * 60);
  const evening = parseTimeToMinutes(prefs.evening_start, 20 * 60);
  const period = getReminderPeriod(prefs);

  if (period === "afternoon") {
    return isWithinRange(localMinutes, afternoon, evening);
  }

  if (period === "evening") {
    return isWithinRange(localMinutes, evening, morning);
  }

  return isWithinRange(localMinutes, morning, afternoon);
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Parse request for optional filters
    let frequency: string | null = null;
    try {
      const body = await req.json();
      frequency = body.frequency || null;
    } catch {
      // No body provided, that's ok
    }

    const now = new Date();
    const currentDate = now.toISOString().split('T')[0];

    // Determine which questionnaires to check based on schedule or explicit frequency
    let frequenciesToCheck: string[] = [];

    if (frequency) {
      frequenciesToCheck = [frequency];
    } else {
      // We evaluate local weekday/monthday per user later, so fetch all supported frequencies.
      frequenciesToCheck = ['daily', 'weekly', 'monthly', 'entry'];
    }

    const { data: pendingQuestionnaires, error: questionnairesError } = await supabaseAdmin
      .rpc('get_pending_questionnaires_for_notifications', {
        p_current_date: currentDate,
        p_current_timestamp: now.toISOString(),
        p_frequencies: frequenciesToCheck
      });

    if (questionnairesError) {
      return new Response(
        JSON.stringify({ error: `Database error: ${questionnairesError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const pendingList = (pendingQuestionnaires as QuestionnaireReminder[] | null) ?? [];

    if (pendingList.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          notifications_sent: 0,
          message: 'No pending questionnaires',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userIds = [...new Set(pendingList.map((q) => q.user_id))];

    const { data: sessionsResult, error: sessionsError } = await supabaseAdmin.rpc(
      "edge_mobile_notifications",
      {
        p_action: "get_mobile_sessions",
        p_payload: {
          user_ids: userIds,
        },
      }
    );

    if (sessionsError) {
      return new Response(
        JSON.stringify({ error: `Session lookup failed: ${sessionsError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const sessions = ((sessionsResult as { rows?: Array<{ user_id: string; fcm_token: string }> } | null)?.rows ?? []);

    const userTokens = new Map<string, string[]>();
    for (const session of sessions) {
      if (!session.user_id || !session.fcm_token) continue;
      if (!userTokens.has(session.user_id)) {
        userTokens.set(session.user_id, []);
      }
      userTokens.get(session.user_id)!.push(session.fcm_token);
    }

    const { data: preferencesResult, error: preferencesError } = await supabaseAdmin.rpc(
      "edge_mobile_notifications",
      {
        p_action: "get_notification_preferences",
        p_payload: {
          user_ids: userIds,
        },
      }
    );

    if (preferencesError) {
      return new Response(
        JSON.stringify({ error: `Preferences lookup failed: ${preferencesError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const preferences = ((preferencesResult as { rows?: NotificationPreferences[] } | null)?.rows ?? []);
    const prefsByUser = new Map<string, NotificationPreferences>();
    for (const pref of preferences) {
      prefsByUser.set(pref.user_id, pref);
    }

    const questionnairesByUser = new Map<string, QuestionnaireReminder[]>();
    for (const q of pendingList) {
      if (!questionnairesByUser.has(q.user_id)) {
        questionnairesByUser.set(q.user_id, []);
      }
      questionnairesByUser.get(q.user_id)!.push(q);
    }

    const candidateTargets: NotificationTarget[] = [];
    for (const [userId, questionnaires] of questionnairesByUser.entries()) {
      const prefs = prefsByUser.get(userId);
      if (!shouldSendNow(prefs, now)) continue;
      const dueQuestionnaires = frequency
        ? questionnaires
        : questionnaires.filter((q) => shouldQueueFrequencyForUser(q.frequency, prefs, now));
      if (dueQuestionnaires.length === 0) continue;

      const dedupe = buildReminderDedupeKey(userId, prefs, now);
      candidateTargets.push({
        user_id: userId,
        fcm_tokens: userTokens.get(userId) ?? [],
        questionnaires: dueQuestionnaires,
        dedupe_key: dedupe.key,
        reminder_period: dedupe.period,
        local_date: dedupe.localDate,
      });
    }

    if (candidateTargets.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          notifications_sent: 0,
          message: 'No eligible recipients',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: dedupeResult, error: dedupeError } = await supabaseAdmin.rpc(
      "edge_mobile_notifications",
      {
        p_action: "get_existing_questionnaire_reminder_keys",
        p_payload: {
          dedupe_keys: candidateTargets.map((target) => target.dedupe_key),
          user_ids: candidateTargets.map((target) => target.user_id),
        },
      }
    );

    if (dedupeError) {
      return new Response(
        JSON.stringify({ error: `Dedupe lookup failed: ${dedupeError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const existingRows = ((dedupeResult as { rows?: Array<{ dedupe_key: string | null }> } | null)?.rows ?? []);
    const existingKeys = new Set(
      existingRows
        .map((row) => row.dedupe_key)
        .filter((key): key is string => typeof key === "string" && key.length > 0)
    );

    const notificationTargets = candidateTargets.filter(
      (target) => !existingKeys.has(target.dedupe_key)
    );

    if (notificationTargets.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          notifications_sent: 0,
          message: 'No eligible recipients (already reminded in this period)',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!isFcmConfigured()) {
      return new Response(
        JSON.stringify({ error: 'FIREBASE_SERVICE_ACCOUNT_JSON not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let accessToken: string;
    let projectId: string;
    try {
      accessToken = await getFcmAccessToken();
      projectId = getFcmProjectId();
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return new Response(
        JSON.stringify({ error: `FCM auth error: ${errMsg}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let inAppInserted = 0;
    const inAppRows = notificationTargets.map((target) => {
      const copy = getNotificationCopy(target.questionnaires);
      return {
        link: copy.link,
        message: copy.body,
        metadata: {
          dedupe_key: target.dedupe_key,
          local_date: target.local_date,
          reminder_period: target.reminder_period,
          source: 'questionnaire_reminder',
          questionnaire_count: copy.count,
          questionnaire_codes: target.questionnaires.map((q) => q.questionnaire_code),
          questionnaire_ids: target.questionnaires.map((q) => q.questionnaire_id),
          study_registration_ids: target.questionnaires.map((q) => q.study_registration_id),
          frequencies: [...new Set(target.questionnaires.map((q) => q.frequency))],
        },
        title: copy.title,
        type: 'questionnaire_request',
        user_id: target.user_id,
      };
    });

    for (const batch of chunk(inAppRows, 500)) {
      const { data: inAppResult, error: inAppError } = await supabaseAdmin.rpc(
        "edge_mobile_notifications",
        {
          p_action: "insert_notifications_bulk",
          p_payload: {
            rows: batch,
          },
        }
      );

      if (inAppError) {
        return new Response(
          JSON.stringify({ error: `In-app insert failed: ${inAppError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      inAppInserted += (inAppResult as { inserted?: number } | null)?.inserted ?? batch.length;
    }

    let sentCount = 0;
    let failedCount = 0;
    let usersWithPushTokens = 0;
    let webSentCount = 0;
    let webFailedCount = 0;
    let usersWithWebPushSubscriptions = 0;

    const pushFunctionUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push-notification`;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    for (const target of notificationTargets) {
      const copy = getNotificationCopy(target.questionnaires);
      const data = buildPushData(copy, target.dedupe_key);

      if (target.fcm_tokens.length > 0) {
        usersWithPushTokens += 1;
      }

      for (const token of target.fcm_tokens) {
        try {
          const response = await fetch(
            `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
            {
              signal: AbortSignal.timeout(15_000),
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({
                message: {
                  token,
                  notification: {
                    title: copy.title,
                    body: copy.body,
                  },
                  data,
                  android: {
                    priority: 'high',
                    notification: {
                      sound: 'default',
                      channelId: 'platform_questionnaires',
                    },
                  },
                  apns: {
                    payload: {
                      aps: {
                        sound: 'default',
                        badge: copy.count,
                        'content-available': 1,
                      },
                    },
                  },
                },
              }),
            }
          );

          if (response.ok) {
            sentCount++;
          } else {
            failedCount++;
            const errorText = await response.text();

            if (errorText.includes('UNREGISTERED') || errorText.includes('INVALID_ARGUMENT')) {
              await supabaseAdmin.rpc("edge_mobile_notifications", {
                p_action: "null_mobile_session_token",
                p_payload: {
                  fcm_token: token,
                },
              });
            }
          }
        } catch (err) {
          console.warn("[send-questionnaire-reminders] mobile push attempt failed:", err);
          failedCount++;
        }
      }

      if (!serviceRoleKey) {
        webFailedCount++;
        continue;
      }

      try {
        if (!pushFunctionUrl.startsWith("https://")) throw new Error("SSRF Prevention");
        const response = await fetch(pushFunctionUrl, {
            signal: AbortSignal.timeout(15000),
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            user_id: target.user_id,
            title: copy.title,
            body: copy.body,
            data,
            send_mobile: false,
            send_web: true,
          }),
        });

        if (!response.ok) {
          webFailedCount++;
          continue;
        }

        const webResult = await response.json();
        webSentCount += Number(webResult?.web_sent ?? webResult?.sent ?? 0);
        webFailedCount += Number(webResult?.web_failed ?? webResult?.failed ?? 0);

        if (Number(webResult?.web_targeted ?? 0) > 0) {
          usersWithWebPushSubscriptions += 1;
        }
      } catch (err) {
        console.warn("[send-questionnaire-reminders] web push attempt failed:", err);
        webFailedCount++;
      }
    }

    await supabaseAdmin.rpc("edge_mobile_notifications", {
      p_action: "insert_notification_log",
      p_payload: {
        created_at: new Date().toISOString(),
        data: {
          deduped_users: candidateTargets.length - notificationTargets.length,
          frequencies: frequenciesToCheck,
          in_app_inserted: inAppInserted,
          pending_count: pendingList.length,
          web_failed: webFailedCount,
          web_sent: webSentCount,
          users_with_web_push_subscriptions: usersWithWebPushSubscriptions,
          users_with_push_tokens: usersWithPushTokens,
        },
        devices_failed: failedCount + webFailedCount,
        devices_sent: sentCount + webSentCount,
        notification_type: 'questionnaire_reminder',
        recipients_count: notificationTargets.length,
        title: `Questionnaire reminders (${frequenciesToCheck.join(', ')})`,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        pending_questionnaires: pendingList.length,
        users_notified: notificationTargets.length,
        users_with_push_tokens: usersWithPushTokens,
        users_without_push_tokens: notificationTargets.length - usersWithPushTokens,
        users_with_web_push_subscriptions: usersWithWebPushSubscriptions,
        in_app_notifications_created: inAppInserted,
        notifications_sent: sentCount,
        notifications_failed: failedCount,
        web_notifications_sent: webSentCount,
        web_notifications_failed: webFailedCount,
        frequencies_checked: frequenciesToCheck,
        timestamp: now.toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function getFrequencyMessage(frequency: string): string {
  switch (frequency) {
    case 'daily':
      return 'Váš denní dotazník je připraven k vyplnění';
    case 'weekly':
      return 'Váš týdenní dotazník je připraven k vyplnění';
    case 'monthly':
      return 'Váš měsíční dotazník je připraven k vyplnění';
    case 'entry':
      return 'Vstupní dotazník čeká na vyplnění';
    default:
      return 'Dotazník je připraven k vyplnění';
  }
}
