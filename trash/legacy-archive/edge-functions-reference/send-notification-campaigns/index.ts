// Send Notification Campaigns Edge Function
// Processes scheduled notification campaigns and sends push + in-app notifications.
// Intended to be triggered by cron (e.g. every minute).

import { serve, createClient } from "../_shared/deps.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CampaignRow {
  id: string;
  name: string;
  title_key: string;
  body_key: string;
  base_locale: string;
  link: string | null;
  data: Record<string, unknown> | null;
  audience_type: string;
  audience_filter: Record<string, unknown> | null;
  send_push: boolean;
  send_inapp: boolean;
  is_active: boolean;
}

interface ScheduleRow {
  id: string;
  campaign_id: string;
  next_run_at: string;
  repeat_interval_minutes: number | null;
}

interface NotificationPreferences {
  user_id: string;
  push_enabled: boolean | null;
  quiet_hours_enabled: boolean | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  morning_start: string | null;
  afternoon_start: string | null;
  evening_start: string | null;
  questionnaire_reminder_period: string | null;
  user_timezone: string | null;
}

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

const isWithinRange = (value: number, start: number, end: number): boolean => {
  if (start === end) return true;
  if (start < end) return value >= start && value < end;
  return value >= start || value < end;
};

const shouldSendNow = (prefs: NotificationPreferences | undefined, now: Date): boolean => {
  if (!prefs) return true;
  if (prefs.push_enabled === false) return false;

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
  const period = prefs.questionnaire_reminder_period || "morning";

  if (period === "afternoon") {
    return isWithinRange(localMinutes, afternoon, evening);
  }

  if (period === "evening") {
    return isWithinRange(localMinutes, evening, morning);
  }

  return isWithinRange(localMinutes, morning, afternoon);
};

const chunk = <T,>(items: T[], size = 500): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const normalizePayloadData = (data: Record<string, unknown> | null, extras: Record<string, string>): Record<string, string> => {
  const payload: Record<string, string> = { ...extras };
  if (!data) return payload;
  Object.entries(data).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    payload[key] = typeof value === "string" ? value : JSON.stringify(value);
  });
  return payload;
};

async function resolveTargets(
  supabaseAdmin: ReturnType<typeof createClient>,
  campaign: CampaignRow,
  nowIso: string,
  today: string
): Promise<string[]> {
  const filter = campaign.audience_filter ?? {};

  if (campaign.audience_type === "study") {
    const studyId = typeof filter.study_id === "string" ? filter.study_id : null;
    if (!studyId) return [];
    const { data } = await supabaseAdmin.rpc("edge_notification_campaigns", {
      p_action: "get_active_study_user_ids",
      p_payload: {
        study_id: studyId,
      },
    });
    const rows = (data as { rows?: Array<{ user_id?: string }> } | null)?.rows ?? [];
    return rows
      .map((row) => row.user_id)
      .filter((id): id is string => typeof id === "string");
  }

  if (campaign.audience_type === "questionnaire_due") {
    const frequencies = Array.isArray(filter.frequencies)
      ? filter.frequencies.filter((f) => typeof f === "string")
      : ["daily", "weekly", "monthly", "entry"];
    const { data } = await supabaseAdmin.rpc("get_pending_questionnaires_for_notifications", {
      p_current_date: today,
      p_current_timestamp: nowIso,
      p_frequencies: frequencies
    });
    const rows = Array.isArray(data) ? data : [];
    const ids = rows
      .map((row) => (row as { user_id?: string }).user_id)
      .filter((id): id is string => typeof id === "string");
    return ids;
  }

  if (campaign.audience_type === "user_list") {
    const ids = Array.isArray(filter.user_ids)
      ? filter.user_ids.filter((id) => typeof id === "string")
      : [];
    return ids as string[];
  }

  // Default: all users
  const { data } = await supabaseAdmin.rpc("edge_notification_campaigns", {
    p_action: "get_all_profile_user_ids",
    p_payload: {},
  });
  const rows = (data as { rows?: Array<{ user_id?: string }> } | null)?.rows ?? [];
  return rows
    .map((row) => row.user_id)
    .filter((id): id is string => typeof id === "string");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const now = new Date();
  const nowIso = now.toISOString();
  const today = nowIso.split("T")[0];

  try {
    const { data: schedulesResult, error: schedulesError } = await supabaseAdmin.rpc("edge_notification_campaigns", {
      p_action: "get_due_schedules",
      p_payload: {
        now: nowIso,
      },
    });

    if (schedulesError) {
      return new Response(
        JSON.stringify({ error: schedulesError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const schedules = (schedulesResult as { rows?: ScheduleRow[] } | null)?.rows ?? [];

    if (!schedules || schedules.length === 0) {
      return new Response(
        JSON.stringify({ success: true, processed: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const campaignIds = [...new Set(schedules.map((s) => s.campaign_id))];
    const { data: campaignsResult, error: campaignsError } = await supabaseAdmin.rpc("edge_notification_campaigns", {
      p_action: "get_campaigns",
      p_payload: {
        campaign_ids: campaignIds,
      },
    });

    if (campaignsError) {
      return new Response(
        JSON.stringify({ error: campaignsError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const campaigns = (campaignsResult as { rows?: CampaignRow[] } | null)?.rows ?? [];

    const campaignMap = new Map<string, CampaignRow>();
    (campaigns || []).forEach((campaign) => {
      campaignMap.set(campaign.id, campaign as CampaignRow);
    });

    let processed = 0;
    const results: Array<{ schedule_id: string; status: string }> = [];

    for (const schedule of schedules as ScheduleRow[]) {
      const campaign = campaignMap.get(schedule.campaign_id);
      if (!campaign) {
        await supabaseAdmin.rpc("edge_notification_campaigns", {
          p_action: "update_schedule",
          p_payload: {
            last_run_at: nowIso,
            schedule_id: schedule.id,
            status: "completed",
          },
        });
        results.push({ schedule_id: schedule.id, status: "skipped" });
        continue;
      }

      const { data: claimResult } = await supabaseAdmin.rpc("edge_notification_campaigns", {
        p_action: "claim_schedule",
        p_payload: {
          now: nowIso,
          schedule_id: schedule.id,
        },
      });

      if (!(claimResult as { claimed?: boolean } | null)?.claimed) {
        continue;
      }

      const errors: string[] = [];

      try {
        const targetIdsRaw = await resolveTargets(supabaseAdmin, campaign, nowIso, today);
        const targetUserIds = [...new Set(targetIdsRaw)];

        if (targetUserIds.length === 0) {
          await supabaseAdmin.rpc("edge_notification_campaigns", {
            p_action: "insert_run",
            p_payload: {
              campaign_id: campaign.id,
              inapp_sent: 0,
              push_sent: 0,
              recipients_count: 0,
              run_at: nowIso,
              schedule_id: schedule.id,
              status: "sent",
            },
          });
        } else {
          const { data: prefsResult } = await supabaseAdmin.rpc("edge_mobile_notifications", {
            p_action: "get_notification_preferences",
            p_payload: {
              user_ids: targetUserIds,
            },
          });
          const prefs = (prefsResult as { rows?: NotificationPreferences[] } | null)?.rows ?? [];

          const prefsMap = new Map<string, NotificationPreferences>();
          (prefs || []).forEach((row) => {
            prefsMap.set(row.user_id as string, row as NotificationPreferences);
          });

          const pushUserIds = campaign.send_push
            ? targetUserIds.filter((id) => shouldSendNow(prefsMap.get(id), now))
            : [];
          const inappUserIds = campaign.send_inapp ? targetUserIds : [];

          const { data: profilesResult } = await supabaseAdmin.rpc("edge_profiles", {
            p_action: "get_languages",
            p_payload: {
              user_ids: targetUserIds,
            },
          });
          const profiles = (profilesResult as { rows?: Array<{ user_id: string; preferred_language: string | null }> } | null)?.rows ?? [];

          const localeMap = new Map<string, string>();
          (profiles || []).forEach((row) => {
            if (row.user_id) {
              localeMap.set(row.user_id as string, (row.preferred_language as string) || campaign.base_locale);
            }
          });

          const groupByLocale = (ids: string[]) => {
            const groups = new Map<string, string[]>();
            ids.forEach((id) => {
              const locale = localeMap.get(id) || campaign.base_locale || "en";
              const list = groups.get(locale) ?? [];
              list.push(id);
              groups.set(locale, list);
            });
            return groups;
          };

          const inappGroups = groupByLocale(inappUserIds);
          const pushGroups = groupByLocale(pushUserIds);

          let inappCount = 0;
          let pushCount = 0;
          let pushFailedCount = 0;

          for (const [locale, ids] of inappGroups.entries()) {
            const { data: translations, error: translationError } = await supabaseAdmin.rpc(
              "get_translations_map_with_fallback",
              {
                p_fallback_locale: campaign.base_locale || "en",
                p_keys: [campaign.title_key, campaign.body_key],
                p_locale: locale,
                p_namespace: "notifications"
              }
            );

            if (translationError) {
              errors.push("translation_error");
              continue;
            }

            const map = new Map<string, string>();
            (translations || []).forEach((row: { key: string; value: string }) => {
              map.set(row.key, row.value);
            });

            const title = map.get(campaign.title_key) || campaign.title_key;
            const body = map.get(campaign.body_key) || campaign.body_key;

            const rows = ids.map((user_id) => ({
              link: campaign.link,
              message: body,
              metadata: {
                campaign_id: campaign.id,
                schedule_id: schedule.id,
              },
              title,
              type: "campaign",
              user_id,
            }));

            for (const batch of chunk(rows, 500)) {
              const { error } = await supabaseAdmin.rpc("edge_mobile_notifications", {
                p_action: "insert_notifications_bulk",
                p_payload: {
                  rows: batch,
                },
              });
              if (error) {
                errors.push("inapp_insert_failed");
              } else {
                inappCount += batch.length;
              }
            }
          }

          for (const [locale, ids] of pushGroups.entries()) {
            const { data: translations, error: translationError } = await supabaseAdmin.rpc(
              "get_translations_map_with_fallback",
              {
                p_fallback_locale: campaign.base_locale || "en",
                p_keys: [campaign.title_key, campaign.body_key],
                p_locale: locale,
                p_namespace: "notifications"
              }
            );

            if (translationError) {
              errors.push("translation_error");
              continue;
            }

            const map = new Map<string, string>();
            (translations || []).forEach((row: { key: string; value: string }) => {
              map.set(row.key, row.value);
            });

            const title = map.get(campaign.title_key) || campaign.title_key;
            const body = map.get(campaign.body_key) || campaign.body_key;

            const payload = {
              user_ids: ids,
              title,
              body,
              send_mobile: true,
              send_web: true,
              data: normalizePayloadData(campaign.data, {
                campaign_id: campaign.id,
                schedule_id: schedule.id,
              }),
            };

            const response = await fetch(
              `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push-notification`,
              {
                signal: AbortSignal.timeout(15_000),
                method: "POST",
                headers: {
                  Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
              }
            );

            if (!response.ok) {
              errors.push("push_failed");
              continue;
            }

            const result = await response.json();
            pushCount += result?.sent ?? 0;
            pushFailedCount += result?.failed ?? 0;
            if ((result?.failed ?? 0) > 0) {
              errors.push("push_partial_failed");
            }
          }

          const totalRecipients = new Set([...inappUserIds, ...pushUserIds]).size;

          await supabaseAdmin.rpc("edge_notification_campaigns", {
            p_action: "insert_run",
            p_payload: {
              campaign_id: campaign.id,
              errors: errors.length > 0 ? errors : null,
              inapp_sent: inappCount,
              push_sent: pushCount,
              recipients_count: totalRecipients,
              run_at: nowIso,
              schedule_id: schedule.id,
              status: errors.length > 0 || pushFailedCount > 0 ? "partial" : "sent",
            },
          });
        }

        const nextRunAt = schedule.repeat_interval_minutes
          ? new Date(now.getTime() + schedule.repeat_interval_minutes * 60_000).toISOString()
          : schedule.next_run_at;
        const nextStatus = schedule.repeat_interval_minutes ? "scheduled" : "completed";

        await supabaseAdmin.rpc("edge_notification_campaigns", {
          p_action: "update_schedule",
          p_payload: {
            last_run_at: nowIso,
            next_run_at: nextRunAt,
            schedule_id: schedule.id,
            status: nextStatus,
          },
        });

        processed += 1;
        results.push({ schedule_id: schedule.id, status: nextStatus });
      } catch {
        await supabaseAdmin.rpc("edge_notification_campaigns", {
          p_action: "update_schedule",
          p_payload: {
            last_run_at: nowIso,
            schedule_id: schedule.id,
            status: "failed",
          },
        });
        results.push({ schedule_id: schedule.id, status: "failed" });
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
