// Send Push Notification Edge Function
// Sends push notifications to mobile devices (FCM/APNS) and browser subscriptions (Web Push + VAPID)

import { serve, createClient } from "../_shared/deps.ts";
import { getFcmAccessToken, getFcmProjectId, isFcmConfigured } from "../_shared/fcm-auth.ts";
import {
  isWebPushConfigured,
  sendWebPushNotifications,
  type WebPushSubscriptionRow,
} from "../_shared/web-push.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NotificationPayload {
  user_id?: string;
  user_ids?: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
  link?: string;
  badge?: number;
  sound?: string;
  priority?: "high" | "normal";
  send_mobile?: boolean;
  send_web?: boolean;
}

interface FCMMessage {
  token: string;
  notification: {
    title: string;
    body: string;
  };
  data?: Record<string, string>;
  android?: {
    priority: "high" | "normal";
    notification?: {
      sound?: string;
      channelId?: string;
    };
  };
  apns?: {
    payload: {
      aps: {
        badge?: number;
        sound?: string;
        "content-available"?: number;
      };
    };
  };
}

async function sendFCMNotification(
  fcmToken: string,
  payload: NotificationPayload,
  accessToken: string,
  projectId: string
): Promise<{ success: boolean; error?: string }> {
  const message: FCMMessage = {
    token: fcmToken,
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: payload.data,
    android: {
      priority: payload.priority || "high",
      notification: {
        sound: payload.sound || "default",
        channelId: "platform_notifications",
      },
    },
    apns: {
      payload: {
        aps: {
          badge: payload.badge,
          sound: payload.sound || "default",
          "content-available": 1,
        },
      },
    },
  };

  try {
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        signal: AbortSignal.timeout(15_000),
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ message }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `FCM error: ${response.status} - ${errorText}` };
    }

    return { success: true };
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Network error: ${errMsg}` };
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify authorization
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Only allow service_role or authenticated admin calls
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Parse payload
    const payload: NotificationPayload = await req.json();

    if (!payload.title || !payload.body) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: title, body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get target user IDs
    const userIds = payload.user_ids || (payload.user_id ? [payload.user_id] : []);

    if (userIds.length === 0) {
      return new Response(
        JSON.stringify({ error: "Missing user_id or user_ids" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sendMobile = payload.send_mobile !== false;
    const sendWeb = payload.send_web !== false;

    if (!sendMobile && !sendWeb) {
      return new Response(
        JSON.stringify({ error: "No delivery channels enabled (send_mobile/send_web both false)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let sessions: Array<{ user_id: string; fcm_token: string; device_platform: string | null }> = [];
    let webSubscriptions: WebPushSubscriptionRow[] = [];
    const errors: string[] = [];

    if (sendMobile) {
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
        errors.push(`mobile_session_lookup_failed:${sessionsError.message}`);
      } else {
        sessions =
          ((sessionsResult as {
            rows?: Array<{ user_id: string; fcm_token: string; device_platform: string | null }>;
          } | null)?.rows ?? []);
      }
    }

    if (sendWeb) {
      const { data: webResult, error: webLookupError } = await supabaseAdmin.rpc(
        "get_active_web_push_subscriptions_for_users",
        {
          p_user_ids: userIds,
        }
      );

      if (webLookupError) {
        errors.push(`web_subscription_lookup_failed:${webLookupError.message}`);
      } else {
        webSubscriptions = (webResult as WebPushSubscriptionRow[] | null) ?? [];
      }
    }

    if (sessions.length === 0 && webSubscriptions.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          sent: 0,
          failed: 0,
          mobile_sent: 0,
          mobile_failed: 0,
          mobile_targeted: 0,
          web_sent: 0,
          web_failed: 0,
          web_targeted: 0,
          channels: { mobile: sendMobile, web: sendWeb },
          message: "No active push targets found for specified users",
          errors: errors.length > 0 ? errors : undefined,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mobile push delivery
    let mobileSentCount = 0;
    let mobileFailedCount = 0;

    if (sendMobile && sessions.length > 0) {
      if (!isFcmConfigured()) {
        mobileFailedCount += sessions.length;
        errors.push("fcm_not_configured");
      } else {
        let accessToken: string;
        let projectId: string;

        try {
          accessToken = await getFcmAccessToken();
          projectId = getFcmProjectId();
        } catch (error: unknown) {
          const errMsg = error instanceof Error ? error.message : String(error);
          mobileFailedCount += sessions.length;
          errors.push(`fcm_auth_error:${errMsg}`);
          accessToken = "";
          projectId = "";
        }

        if (accessToken && projectId) {
          for (const session of sessions) {
            const result = await sendFCMNotification(session.fcm_token, payload, accessToken, projectId);

            if (result.success) {
              mobileSentCount++;
            } else {
              mobileFailedCount++;
              if (result.error) {
                errors.push(result.error);
              }

              // If token is invalid, mark session for cleanup
              if (result.error?.includes("UNREGISTERED") || result.error?.includes("INVALID_ARGUMENT")) {
                await supabaseAdmin.rpc("edge_mobile_notifications", {
                  p_action: "null_mobile_session_token",
                  p_payload: {
                    fcm_token: session.fcm_token,
                    user_id: session.user_id,
                  },
                });
              }
            }
          }
        }
      }
    }

    // Browser Web Push delivery
    let webSentCount = 0;
    let webFailedCount = 0;
    const webPushEnabled = sendWeb && isWebPushConfigured();

    if (sendWeb && webSubscriptions.length > 0) {
      if (!webPushEnabled) {
        webFailedCount += webSubscriptions.length;
        errors.push("web_push_not_configured");
      } else {
        const webResult = await sendWebPushNotifications(webSubscriptions, {
          title: payload.title,
          body: payload.body,
          link: payload.link ?? payload.data?.link ?? "/",
          tag: payload.data?.type ?? "notification",
          data: payload.data,
        });

        webSentCount += webResult.sent;
        webFailedCount += webResult.failed;
        if (webResult.errors.length > 0) {
          errors.push(...webResult.errors.slice(0, 20));
        }

        if (webResult.invalidEndpoints.length > 0) {
          await supabaseAdmin.rpc("deactivate_web_push_subscriptions_by_endpoints", {
            p_endpoints: webResult.invalidEndpoints,
            p_reason: "remote_endpoint_invalid",
          });
        }
      }
    }

    const sentCount = mobileSentCount + webSentCount;
    const failedCount = mobileFailedCount + webFailedCount;

    // Log notification send - fire and forget, ignore errors
    void supabaseAdmin.rpc("edge_mobile_notifications", {
      p_action: "insert_notification_log",
      p_payload: {
        created_at: new Date().toISOString(),
        data: {
          body: payload.body,
          channels: {
            mobile: sendMobile,
            web: sendWeb,
          },
          errors: errors.length > 0 ? errors : null,
          mobile_failed: mobileFailedCount,
          mobile_sent: mobileSentCount,
          payload_data: payload.data ?? null,
          web_failed: webFailedCount,
          web_sent: webSentCount,
        },
        devices_failed: failedCount,
        devices_sent: sentCount,
        error_message: errors.length > 0 ? errors.join("; ") : null,
        notification_type: "push",
        recipients_count: userIds.length,
        title: payload.title,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        sent: sentCount,
        failed: failedCount,
        mobile_sent: mobileSentCount,
        mobile_failed: mobileFailedCount,
        mobile_targeted: sessions.length,
        web_sent: webSentCount,
        web_failed: webFailedCount,
        web_targeted: webSubscriptions.length,
        channels: {
          mobile: sendMobile,
          web: sendWeb,
        },
        errors: errors.length > 0 ? errors : undefined,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
