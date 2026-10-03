// Send Reminder Notifications Edge Function
// Scheduled function to send push notifications for due reminders
// Should be called via cron every minute

import { serve, createClient } from '../_shared/deps.ts';
import { getFcmAccessToken, getFcmProjectId, isFcmConfigured } from "../_shared/fcm-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ReminderNotification {
  user_id: string;
  reminder_id: string;
  reminder_title: string;
  reminder_type: string;
  points_per_completion: number;
  fcm_tokens: string[];
}

async function sendReminderFcmNotification(
  accessToken: string,
  projectId: string,
  token: string,
  notification: ReminderNotification,
): Promise<{ success: boolean; error?: string }> {
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
        body: JSON.stringify({
          message: {
            token,
            notification: {
              title: `Reminder: ${notification.reminder_title}`,
              body: `Complete now to earn ${notification.points_per_completion} points!`,
            },
            data: {
              points: String(notification.points_per_completion),
              reminder_id: notification.reminder_id,
              reminder_type: notification.reminder_type,
              type: "reminder",
            },
            android: {
              priority: "high",
              notification: {
                sound: "default",
                channelId: "platform_reminders",
              },
            },
            apns: {
              payload: {
                aps: {
                  sound: "default",
                  badge: 1,
                  "content-available": 1,
                },
              },
            },
          },
        }),
      }
    );

    if (response.ok) {
      return { success: true };
    }

    const errorText = await response.text();
    return {
      success: false,
      error: `fcm_send_failed:${response.status}:${errorText}`,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `fcm_network_error:${message}`,
    };
  }
}

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

    // Get current time window (current minute)
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 5); // HH:MM format
    const currentDow = now.getDay(); // 0=Sunday, 1=Monday, etc.
    const currentDate = now.toISOString().split('T')[0];

    // Find reminders due now that haven't been completed today
    const { data: dueReminders, error: remindersError } = await supabaseAdmin
      .rpc('get_due_reminders_for_notification', {
        p_current_date: currentDate,
        p_current_dow: currentDow,
        p_current_time: currentTime
      });

    if (remindersError) {
      return new Response(
        JSON.stringify({ error: `Database error: ${remindersError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const notifications = ((dueReminders as ReminderNotification[] | null) ?? [])
      .filter((row) => Array.isArray(row.fcm_tokens) && row.fcm_tokens.length > 0);

    if (notifications.length === 0) {
      return new Response(
        JSON.stringify({ success: true, notifications_sent: 0, message: 'No reminders due' }),
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
      const message = error instanceof Error ? error.message : String(error);
      return new Response(
        JSON.stringify({ error: `FCM auth error: ${message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let sentCount = 0;
    let failedCount = 0;

    for (const notification of notifications) {
      for (const token of notification.fcm_tokens) {
        const result = await sendReminderFcmNotification(accessToken, projectId, token, notification);

        if (result.success) {
          sentCount++;
        } else {
          failedCount++;

          // Clean up invalid tokens
          if (
            result.error?.includes('UNREGISTERED') ||
            result.error?.includes('INVALID_ARGUMENT')
          ) {
            await supabaseAdmin.rpc('edge_mobile_notifications', {
              p_action: 'null_mobile_session_token',
              p_payload: {
                fcm_token: token,
              }
            });
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        reminders_due: notifications.length,
        notifications_sent: sentCount,
        notifications_failed: failedCount,
        timestamp: now.toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    console.error('Error sending reminder notifications:', error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
