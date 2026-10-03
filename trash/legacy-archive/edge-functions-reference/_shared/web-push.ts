import webPushModule from "https://esm.sh/web-push@3.6.7";

interface WebPushClient {
  setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void;
  sendNotification: (
    subscription: {
      endpoint: string;
      expirationTime: number | null;
      keys: { p256dh: string; auth: string };
    },
    payload?: string,
    options?: {
      TTL?: number;
      urgency?: "very-low" | "low" | "normal" | "high";
      topic?: string;
      vapidDetails?: {
        subject: string;
        publicKey: string;
        privateKey: string;
      };
    }
  ) => Promise<unknown>;
}

const webPush = webPushModule as unknown as WebPushClient;

export interface WebPushSubscriptionRow {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expiration_time: string | null;
}

export interface WebPushPayload {
  title: string;
  body: string;
  link?: string | null;
  tag?: string | null;
  data?: Record<string, string>;
}

export interface WebPushSendResult {
  sent: number;
  failed: number;
  attempted: number;
  invalidEndpoints: string[];
  errors: string[];
  configured: boolean;
}

const getVapidConfig = () => {
  const publicKey = Deno.env.get("WEB_PUSH_VAPID_PUBLIC_KEY")?.trim() ?? "";
  const privateKey = Deno.env.get("WEB_PUSH_VAPID_PRIVATE_KEY")?.trim() ?? "";
  const subjectRaw = Deno.env.get("WEB_PUSH_VAPID_SUBJECT")?.trim();
  const subject = subjectRaw && subjectRaw.length > 0 ? subjectRaw : "mailto:support@platform.com";

  if (!publicKey || !privateKey) {
    return null;
  }

  return { publicKey, privateKey, subject };
};

let vapidInitialized = false;

const ensureWebPushInitialized = (): boolean => {
  if (vapidInitialized) return true;
  const config = getVapidConfig();
  if (!config) return false;
  webPush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  vapidInitialized = true;
  return true;
};

const getStatusCode = (error: unknown): number | null => {
  if (typeof error !== "object" || error === null) return null;
  if (!("statusCode" in error)) return null;
  const raw = (error as { statusCode?: unknown }).statusCode;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "body" in error) {
    const body = (error as { body?: unknown }).body;
    if (typeof body === "string" && body.length > 0) return body;
  }
  return String(error);
};

export const isWebPushConfigured = (): boolean => getVapidConfig() !== null;

/**
 * Sends Web Push notifications to browser subscriptions.
 */
export async function sendWebPushNotifications(
  subscriptions: WebPushSubscriptionRow[],
  payload: WebPushPayload
): Promise<WebPushSendResult> {
  const configured = ensureWebPushInitialized();
  if (!configured || subscriptions.length === 0) {
    return {
      sent: 0,
      failed: 0,
      attempted: subscriptions.length,
      invalidEndpoints: [],
      errors: configured ? [] : ["web_push_not_configured"],
      configured,
    };
  }

  let sent = 0;
  let failed = 0;
  const invalidEndpoints: string[] = [];
  const errors: string[] = [];

  const jsonPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    link: payload.link ?? "/",
    tag: payload.tag ?? null,
    data: payload.data ?? {},
  });

  for (const subscription of subscriptions) {
    try {
      const expirationTime = subscription.expiration_time
        ? new Date(subscription.expiration_time).getTime()
        : null;

      await webPush.sendNotification(
        {
          endpoint: subscription.endpoint,
          expirationTime: Number.isFinite(expirationTime ?? NaN) ? expirationTime : null,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        jsonPayload,
        {
          TTL: 60,
          urgency: "high",
          topic: payload.tag ?? undefined,
        }
      );

      sent += 1;
    } catch (error) {
      failed += 1;

      const statusCode = getStatusCode(error);
      if (statusCode === 404 || statusCode === 410) {
        invalidEndpoints.push(subscription.endpoint);
      }

      errors.push(getErrorMessage(error));
    }
  }

  return {
    sent,
    failed,
    attempted: subscriptions.length,
    invalidEndpoints: [...new Set(invalidEndpoints)],
    errors,
    configured,
  };
}
