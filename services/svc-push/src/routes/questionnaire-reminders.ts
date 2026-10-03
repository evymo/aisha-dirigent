import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { rpcService } from '../postgrest.js';
import { AuthError, verifyServiceRole } from '../auth.js';
import { isFcmConfigured, getFcmAccessToken, getFcmProjectId, sendFcmMessage } from '../lib/fcm.js';
import {
  shouldSendNow, chunk, getLocalDateKey,
  type NotificationPreferences,
} from '../lib/notification-helpers.js';
import { config } from '../config.js';

interface QuestionnaireReminder {
  user_id: string;
  study_registration_id: string;
  questionnaire_id: string;
  questionnaire_code: string;
  questionnaire_title: string;
  frequency: string;
  due_date: string | null;
}

const getLocalCalendarMeta = (date: Date, timeZone: string) => {
  const localDate = getLocalDateKey(date, timeZone);
  const [year, month, day] = localDate.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return { localDate, dayOfMonth: date.getUTCDate(), dayOfWeek: date.getUTCDay() };
  }
  return { localDate, dayOfMonth: day, dayOfWeek: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
};

const getReminderPeriod = (prefs: NotificationPreferences | undefined): 'morning' | 'afternoon' | 'evening' => {
  if (prefs?.questionnaire_reminder_period === 'afternoon') return 'afternoon';
  if (prefs?.questionnaire_reminder_period === 'evening') return 'evening';
  return 'morning';
};

const shouldQueueFrequencyForUser = (freq: string, prefs: NotificationPreferences | undefined, now: Date): boolean => {
  const tz = prefs?.user_timezone || 'UTC';
  const { dayOfMonth, dayOfWeek } = getLocalCalendarMeta(now, tz);
  if (freq === 'monthly') return dayOfMonth === 1;
  if (freq === 'weekly' || freq === 'entry') return dayOfWeek === 1;
  return true;
};

const getNotificationCopy = (questionnaires: QuestionnaireReminder[]) => {
  const count = questionnaires.length;
  const first = questionnaires[0];
  const title = count === 1
    ? `Nový dotazník: ${first.questionnaire_title}`
    : `${count} dotazníků čeká na vyplnění`;
  const body = count === 1
    ? getFrequencyMessage(first.frequency)
    : 'Klikněte pro zobrazení všech dotazníků';
  const link = count === 1
    ? `/questionnaires/${first.questionnaire_id}`
    : '/questionnaires';
  return { title, body, link, first, count };
};

function getFrequencyMessage(frequency: string): string {
  switch (frequency) {
    case 'daily': return 'Váš denní dotazník je připraven k vyplnění';
    case 'weekly': return 'Váš týdenní dotazník je připraven k vyplnění';
    case 'monthly': return 'Váš měsíční dotazník je připraven k vyplnění';
    case 'entry': return 'Vstupní dotazník čeká na vyplnění';
    default: return 'Dotazník je připraven k vyplnění';
  }
}

export async function questionnaireRemindersRoute(app: FastifyInstance): Promise<void> {
  app.post('/questionnaire-reminders', async (req: FastifyRequest, reply: FastifyReply) => {
    // Cron-triggered worker route — service-role token required (least privilege).
    try {
      verifyServiceRole(req.headers.authorization);
    } catch (err) {
      const status = err instanceof AuthError ? err.statusCode : 401;
      return reply.status(status).send({ error: 'Unauthorized' });
    }

    const body = req.body as { frequency?: string } | null;
    const frequency = body?.frequency ?? null;
    const now = new Date();
    const currentDate = now.toISOString().split('T')[0];

    const frequenciesToCheck = frequency ? [frequency] : ['daily', 'weekly', 'monthly', 'entry'];

    const pendingList = (await rpcService<QuestionnaireReminder[] | null>(
      'get_pending_questionnaires_for_notifications',
      { p_current_date: currentDate, p_current_timestamp: now.toISOString(), p_frequencies: frequenciesToCheck },
    )) ?? [];

    if (pendingList.length === 0) {
      return reply.send({ success: true, notifications_sent: 0, message: 'No pending questionnaires' });
    }

    const userIds = [...new Set(pendingList.map((q) => q.user_id))];

    // Get sessions + preferences
    const sessionsResult = await rpcService<{ rows?: Array<{ user_id: string; fcm_token: string }> } | null>(
      'edge_mobile_notifications',
      { p_action: 'get_mobile_sessions', p_payload: { user_ids: userIds } },
    );
    const sessions = sessionsResult?.rows ?? [];

    const userTokens = new Map<string, string[]>();
    for (const s of sessions) {
      if (!s.user_id || !s.fcm_token) continue;
      const list = userTokens.get(s.user_id) ?? [];
      list.push(s.fcm_token);
      userTokens.set(s.user_id, list);
    }

    const prefsResult = await rpcService<{ rows?: NotificationPreferences[] } | null>(
      'edge_mobile_notifications',
      { p_action: 'get_notification_preferences', p_payload: { user_ids: userIds } },
    );
    const prefsByUser = new Map<string, NotificationPreferences>();
    for (const p of prefsResult?.rows ?? []) prefsByUser.set(p.user_id, p);

    // Group questionnaires per user
    const qByUser = new Map<string, QuestionnaireReminder[]>();
    for (const q of pendingList) {
      const list = qByUser.get(q.user_id) ?? [];
      list.push(q);
      qByUser.set(q.user_id, list);
    }

    // Build candidate targets
    interface Target {
      user_id: string;
      fcm_tokens: string[];
      questionnaires: QuestionnaireReminder[];
      dedupe_key: string;
      reminder_period: string;
      local_date: string;
    }

    const candidateTargets: Target[] = [];
    for (const [userId, questionnaires] of qByUser.entries()) {
      const prefs = prefsByUser.get(userId);
      if (!shouldSendNow(prefs, now)) continue;
      const due = frequency ? questionnaires : questionnaires.filter((q) => shouldQueueFrequencyForUser(q.frequency, prefs, now));
      if (due.length === 0) continue;

      const tz = prefs?.user_timezone || 'UTC';
      const localDate = getLocalDateKey(now, tz);
      const period = getReminderPeriod(prefs);
      const dedupeKey = `questionnaire_reminder:${userId}:${localDate}:${period}`;

      candidateTargets.push({
        user_id: userId,
        fcm_tokens: userTokens.get(userId) ?? [],
        questionnaires: due,
        dedupe_key: dedupeKey,
        reminder_period: period,
        local_date: localDate,
      });
    }

    if (candidateTargets.length === 0) {
      return reply.send({ success: true, notifications_sent: 0, message: 'No eligible recipients' });
    }

    // Dedup check
    const dedupeResult = await rpcService<{ rows?: Array<{ dedupe_key: string | null }> } | null>(
      'edge_mobile_notifications',
      {
        p_action: 'get_existing_questionnaire_reminder_keys',
        p_payload: {
          dedupe_keys: candidateTargets.map((t) => t.dedupe_key),
          user_ids: candidateTargets.map((t) => t.user_id),
        },
      },
    );
    const existingKeys = new Set(
      (dedupeResult?.rows ?? []).map((r) => r.dedupe_key).filter((k): k is string => typeof k === 'string'),
    );
    const targets = candidateTargets.filter((t) => !existingKeys.has(t.dedupe_key));

    if (targets.length === 0) {
      return reply.send({ success: true, notifications_sent: 0, message: 'Already reminded in this period' });
    }

    if (!isFcmConfigured()) {
      return reply.status(500).send({ error: 'FIREBASE_SERVICE_ACCOUNT_JSON not configured' });
    }

    const accessToken = await getFcmAccessToken();
    const projectId = getFcmProjectId();

    // In-app notifications
    let inAppInserted = 0;
    const inAppRows = targets.map((t) => {
      const copy = getNotificationCopy(t.questionnaires);
      return {
        link: copy.link,
        message: copy.body,
        metadata: {
          dedupe_key: t.dedupe_key,
          local_date: t.local_date,
          reminder_period: t.reminder_period,
          source: 'questionnaire_reminder',
          questionnaire_count: copy.count,
          questionnaire_codes: t.questionnaires.map((q) => q.questionnaire_code),
          questionnaire_ids: t.questionnaires.map((q) => q.questionnaire_id),
          study_registration_ids: t.questionnaires.map((q) => q.study_registration_id),
          frequencies: [...new Set(t.questionnaires.map((q) => q.frequency))],
        },
        title: copy.title,
        type: 'questionnaire_request',
        user_id: t.user_id,
      };
    });

    for (const batch of chunk(inAppRows, 500)) {
      const result = await rpcService<{ inserted?: number } | null>('edge_mobile_notifications', {
        p_action: 'insert_notifications_bulk',
        p_payload: { rows: batch },
      });
      inAppInserted += result?.inserted ?? batch.length;
    }

    // FCM push
    let sentCount = 0;
    let failedCount = 0;
    let usersWithPushTokens = 0;

    for (const target of targets) {
      const copy = getNotificationCopy(target.questionnaires);
      const data: Record<string, string> = {
        type: 'questionnaire',
        count: String(copy.count),
        link: copy.link,
        dedupe_key: target.dedupe_key,
      };
      if (copy.count === 1) {
        data.questionnaire_id = copy.first.questionnaire_id;
        data.questionnaire_code = copy.first.questionnaire_code;
      }

      if (target.fcm_tokens.length > 0) usersWithPushTokens++;

      for (const token of target.fcm_tokens) {
        const result = await sendFcmMessage({
          token,
          notification: { title: copy.title, body: copy.body },
          data,
          android: { priority: 'high', notification: { sound: 'default', channelId: 'platform_questionnaires' } },
          apns: { payload: { aps: { sound: 'default', badge: copy.count, 'content-available': 1 } } },
        }, accessToken, projectId);

        if (result.success) sentCount++;
        else {
          failedCount++;
          if (result.error?.includes('UNREGISTERED') || result.error?.includes('INVALID_ARGUMENT')) {
            void rpcService('edge_mobile_notifications', {
              p_action: 'null_mobile_session_token',
              p_payload: { fcm_token: token },
            }).catch(() => {});
          }
        }
      }

      // Web push via /send
      try {
        const res = await fetch(`http://localhost:${config.port}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.postgrestServiceToken}` },
          body: JSON.stringify({
            user_id: target.user_id, title: copy.title, body: copy.body,
            data, send_mobile: false, send_web: true,
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) {
          const webResult = (await res.json()) as { web_sent?: number };
          sentCount += webResult?.web_sent ?? 0;
        }
      } catch { /* best effort */ }
    }

    // Log
    void rpcService('edge_mobile_notifications', {
      p_action: 'insert_notification_log',
      p_payload: {
        created_at: new Date().toISOString(),
        data: {
          deduped_users: candidateTargets.length - targets.length,
          frequencies: frequenciesToCheck,
          in_app_inserted: inAppInserted,
          pending_count: pendingList.length,
          users_with_push_tokens: usersWithPushTokens,
        },
        devices_failed: failedCount,
        devices_sent: sentCount,
        notification_type: 'questionnaire_reminder',
        recipients_count: targets.length,
        title: `Questionnaire reminders (${frequenciesToCheck.join(', ')})`,
      },
    }).catch(() => {});

    return reply.send({
      success: true,
      pending_questionnaires: pendingList.length,
      users_notified: targets.length,
      users_with_push_tokens: usersWithPushTokens,
      in_app_notifications_created: inAppInserted,
      notifications_sent: sentCount,
      notifications_failed: failedCount,
      frequencies_checked: frequenciesToCheck,
      timestamp: now.toISOString(),
    });
  });
}
