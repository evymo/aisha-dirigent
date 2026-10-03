import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { rpcService } from '../postgrest.js';
import { AuthError, verifyServiceRole } from '../auth.js';
import { isFcmConfigured, getFcmAccessToken, getFcmProjectId, sendFcmMessage } from '../lib/fcm.js';

interface ReminderNotification {
  user_id: string;
  reminder_id: string;
  reminder_title: string;
  reminder_type: string;
  points_per_completion: number;
  fcm_tokens: string[];
}

export async function reminderNotificationsRoute(app: FastifyInstance): Promise<void> {
  app.post('/reminders/process', async (req: FastifyRequest, reply: FastifyReply) => {
    // Cron-triggered worker route — service-role token required (least privilege).
    try {
      verifyServiceRole(req.headers.authorization);
    } catch (err) {
      const status = err instanceof AuthError ? err.statusCode : 401;
      return reply.status(status).send({ error: 'Unauthorized' });
    }

    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 5); // HH:MM
    const currentDow = now.getDay();
    const currentDate = now.toISOString().split('T')[0];

    const dueReminders = (await rpcService<ReminderNotification[] | null>(
      'get_due_reminders_for_notification',
      { p_current_date: currentDate, p_current_dow: currentDow, p_current_time: currentTime },
    )) ?? [];

    const notifications = dueReminders.filter(
      (r) => Array.isArray(r.fcm_tokens) && r.fcm_tokens.length > 0,
    );

    if (notifications.length === 0) {
      return reply.send({ success: true, notifications_sent: 0, message: 'No reminders due' });
    }

    if (!isFcmConfigured()) {
      return reply.status(500).send({ error: 'FIREBASE_SERVICE_ACCOUNT_JSON not configured' });
    }

    const accessToken = await getFcmAccessToken();
    const projectId = getFcmProjectId();

    let sentCount = 0;
    let failedCount = 0;

    for (const notification of notifications) {
      for (const token of notification.fcm_tokens) {
        const result = await sendFcmMessage({
          token,
          notification: {
            title: `Reminder: ${notification.reminder_title}`,
            body: `Complete now to earn ${notification.points_per_completion} points!`,
          },
          data: {
            points: String(notification.points_per_completion),
            reminder_id: notification.reminder_id,
            reminder_type: notification.reminder_type,
            type: 'reminder',
          },
          android: {
            priority: 'high',
            notification: { sound: 'default', channelId: 'platform_reminders' },
          },
          apns: {
            payload: { aps: { sound: 'default', badge: 1, 'content-available': 1 } },
          },
        }, accessToken, projectId);

        if (result.success) {
          sentCount++;
        } else {
          failedCount++;
          if (result.error?.includes('UNREGISTERED') || result.error?.includes('INVALID_ARGUMENT')) {
            void rpcService('edge_mobile_notifications', {
              p_action: 'null_mobile_session_token',
              p_payload: { fcm_token: token },
            }).catch(() => {});
          }
        }
      }
    }

    return reply.send({
      success: true,
      reminders_due: notifications.length,
      notifications_sent: sentCount,
      notifications_failed: failedCount,
      timestamp: now.toISOString(),
    });
  });
}
