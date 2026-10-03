import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { rpcService } from '../postgrest.js';
import { AuthError, verifyServiceRole, verifyToken } from '../auth.js';
import { isFcmConfigured, getFcmAccessToken, getFcmProjectId, sendFcmMessage } from '../lib/fcm.js';
import { isWebPushConfigured, sendWebPushNotifications, type WebPushSubscriptionRow } from '../lib/web-push.js';

interface NotificationPayload {
  user_id?: string;
  user_ids?: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
  link?: string;
  badge?: number;
  sound?: string;
  priority?: 'high' | 'normal';
  send_mobile?: boolean;
  send_web?: boolean;
}

/** Fields that describe the notification content + channel selection. */
export type PushDeliveryPayload = Omit<NotificationPayload, 'user_id' | 'user_ids'>;

/** Per-channel delivery counts returned to callers. */
export interface PushDeliveryResult {
  success: true;
  sent: number;
  failed: number;
  mobile_sent: number;
  mobile_failed: number;
  mobile_targeted: number;
  web_sent: number;
  web_failed: number;
  web_targeted: number;
  channels: { mobile: boolean; web: boolean };
  message?: string;
  errors?: string[];
}

/**
 * Deliver a push notification to an explicit list of user IDs across the
 * mobile (FCM) and web-push (VAPID) channels.
 *
 * Extracted from the `/send` handler so that role-targeted broadcast callers
 * (see routes/send-push-notification.ts) reuse the exact FCM / web-push
 * delivery path instead of duplicating it. Callers are responsible for
 * validating the payload and resolving recipients first.
 */
export async function deliverPush(
  payload: PushDeliveryPayload,
  userIds: string[],
): Promise<PushDeliveryResult> {
  const sendMobile = payload.send_mobile !== false;
  const sendWeb = payload.send_web !== false;

  let sessions: Array<{ user_id: string; fcm_token: string; device_platform: string | null }> = [];
  let webSubscriptions: WebPushSubscriptionRow[] = [];
  const errors: string[] = [];

  // Recipient lookups fail LOUD: an RPC that THROWS (network/DB error) is a hard
  // failure and must propagate so the caller sees a 5xx — NOT be swallowed into a
  // `success: true, 'No active push targets found'` response. A legitimately EMPTY
  // result (user has no registered devices) resolves to null/[] and is handled
  // below as a successful zero-target delivery.
  if (sendMobile && userIds.length > 0) {
    const result = await rpcService<{ rows?: typeof sessions } | null>('edge_mobile_notifications', {
      p_action: 'get_mobile_sessions',
      p_payload: { user_ids: userIds },
    });
    sessions = result?.rows ?? [];
  }

  if (sendWeb && userIds.length > 0) {
    const result = await rpcService<WebPushSubscriptionRow[] | null>('get_active_web_push_subscriptions_for_users', {
      p_user_ids: userIds,
    });
    webSubscriptions = result ?? [];
  }

  if (sessions.length === 0 && webSubscriptions.length === 0) {
    return {
      success: true, sent: 0, failed: 0,
      mobile_sent: 0, mobile_failed: 0, mobile_targeted: 0,
      web_sent: 0, web_failed: 0, web_targeted: 0,
      channels: { mobile: sendMobile, web: sendWeb },
      message: 'No active push targets found',
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  // Mobile FCM delivery
  let mobileSentCount = 0;
  let mobileFailedCount = 0;

  if (sendMobile && sessions.length > 0) {
    if (!isFcmConfigured()) {
      mobileFailedCount += sessions.length;
      errors.push('fcm_not_configured');
    } else {
      try {
        const accessToken = await getFcmAccessToken();
        const projectId = getFcmProjectId();

        for (const session of sessions) {
          const result = await sendFcmMessage({
            token: session.fcm_token,
            notification: { title: payload.title, body: payload.body },
            data: payload.data,
            android: {
              priority: payload.priority || 'high',
              notification: { sound: payload.sound || 'default', channelId: 'platform_notifications' },
            },
            apns: {
              payload: {
                aps: { badge: payload.badge, sound: payload.sound || 'default', 'content-available': 1 },
              },
            },
          }, accessToken, projectId);

          if (result.success) {
            mobileSentCount++;
          } else {
            mobileFailedCount++;
            if (result.error) errors.push(result.error);

            if (result.error?.includes('UNREGISTERED') || result.error?.includes('INVALID_ARGUMENT')) {
              void rpcService('edge_mobile_notifications', {
                p_action: 'null_mobile_session_token',
                p_payload: { fcm_token: session.fcm_token, user_id: session.user_id },
              }).catch(() => { /* best effort */ });
            }
          }
        }
      } catch (err) {
        mobileFailedCount += sessions.length;
        errors.push(`fcm_auth_error:${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Web Push delivery
  let webSentCount = 0;
  let webFailedCount = 0;

  if (sendWeb && webSubscriptions.length > 0) {
    if (!isWebPushConfigured()) {
      webFailedCount += webSubscriptions.length;
      errors.push('web_push_not_configured');
    } else {
      const webResult = await sendWebPushNotifications(webSubscriptions, {
        title: payload.title,
        body: payload.body,
        link: payload.link ?? payload.data?.link ?? '/',
        tag: payload.data?.type ?? 'notification',
        data: payload.data,
      });

      webSentCount += webResult.sent;
      webFailedCount += webResult.failed;
      if (webResult.errors.length > 0) errors.push(...webResult.errors.slice(0, 20));

      if (webResult.invalidEndpoints.length > 0) {
        void rpcService('deactivate_web_push_subscriptions_by_endpoints', {
          p_endpoints: webResult.invalidEndpoints,
          p_reason: 'remote_endpoint_invalid',
        }).catch(() => { /* best effort */ });
      }
    }
  }

  const sentCount = mobileSentCount + webSentCount;
  const failedCount = mobileFailedCount + webFailedCount;

  // Log — fire and forget
  void rpcService('edge_mobile_notifications', {
    p_action: 'insert_notification_log',
    p_payload: {
      created_at: new Date().toISOString(),
      data: {
        body: payload.body,
        channels: { mobile: sendMobile, web: sendWeb },
        errors: errors.length > 0 ? errors : null,
        mobile_failed: mobileFailedCount,
        mobile_sent: mobileSentCount,
        payload_data: payload.data ?? null,
        web_failed: webFailedCount,
        web_sent: webSentCount,
      },
      devices_failed: failedCount,
      devices_sent: sentCount,
      error_message: errors.length > 0 ? errors.join('; ') : null,
      notification_type: 'push',
      recipients_count: userIds.length,
      title: payload.title,
    },
  }).catch(() => { /* best effort */ });

  return {
    success: true,
    sent: sentCount,
    failed: failedCount,
    mobile_sent: mobileSentCount,
    mobile_failed: mobileFailedCount,
    mobile_targeted: sessions.length,
    web_sent: webSentCount,
    web_failed: webFailedCount,
    web_targeted: webSubscriptions.length,
    channels: { mobile: sendMobile, web: sendWeb },
    errors: errors.length > 0 ? errors : undefined,
  };
}

export async function sendPushRoute(app: FastifyInstance): Promise<void> {
  app.post('/send', async (req: FastifyRequest, reply: FastifyReply) => {
    // Auth: primarily service-to-service (service-role token — the internal
    // campaign / reminder callers). A user JWT is also accepted, but is confined
    // to self-target: it may only push to its own user id, never to arbitrary
    // recipient ids supplied in the body.
    const authHeader = req.headers.authorization;
    let selfTargetUserId: string | null = null;
    try {
      verifyServiceRole(authHeader);
    } catch {
      try {
        const user = await verifyToken(authHeader);
        selfTargetUserId = user.userId;
      } catch (err) {
        const status = err instanceof AuthError ? err.statusCode : 401;
        return reply.status(status).send({ error: 'Unauthorized' });
      }
    }

    const payload = req.body as NotificationPayload;

    if (!payload.title || !payload.body) {
      return reply.status(400).send({ error: 'Missing required fields: title, body' });
    }

    // Service-role callers target the requested recipients; a user JWT is forced
    // to itself, dropping any arbitrary user_id / user_ids from the body.
    const userIds = selfTargetUserId
      ? [selfTargetUserId]
      : payload.user_ids || (payload.user_id ? [payload.user_id] : []);
    if (userIds.length === 0) {
      return reply.status(400).send({ error: 'Missing user_id or user_ids' });
    }

    const sendMobile = payload.send_mobile !== false;
    const sendWeb = payload.send_web !== false;

    if (!sendMobile && !sendWeb) {
      return reply.status(400).send({ error: 'No delivery channels enabled' });
    }

    try {
      const result = await deliverPush(payload, userIds);
      return reply.send(result);
    } catch (err) {
      // A recipient-lookup / delivery RPC threw — surface a 5xx rather than a
      // misleading success. Fail loud: the caller can retry.
      req.log.error({ err }, 'push delivery failed');
      return reply.status(502).send({ success: false, error: 'Push delivery failed' });
    }
  });
}
