import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { rpcService } from '../postgrest.js';
import { AuthError, verifyServiceRole } from '../auth.js';
import {
  shouldSendNow, chunk, normalizePayloadData,
  type NotificationPreferences,
} from '../lib/notification-helpers.js';
import { config } from '../config.js';

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

async function resolveTargets(
  campaign: CampaignRow,
  nowIso: string,
  today: string,
): Promise<string[]> {
  const filter = campaign.audience_filter ?? {};

  if (campaign.audience_type === 'study') {
    const studyId = typeof filter.study_id === 'string' ? filter.study_id : null;
    if (!studyId) return [];
    const data = await rpcService<{ rows?: Array<{ user_id?: string }> } | null>('edge_notification_campaigns', {
      p_action: 'get_active_study_user_ids',
      p_payload: { study_id: studyId },
    });
    return (data?.rows ?? []).map((r) => r.user_id).filter((id): id is string => typeof id === 'string');
  }

  if (campaign.audience_type === 'questionnaire_due') {
    const frequencies = Array.isArray(filter.frequencies)
      ? filter.frequencies.filter((f) => typeof f === 'string')
      : ['daily', 'weekly', 'monthly', 'entry'];
    const data = await rpcService<Array<{ user_id?: string }> | null>('get_pending_questionnaires_for_notifications', {
      p_current_date: today,
      p_current_timestamp: nowIso,
      p_frequencies: frequencies,
    });
    return (data ?? []).map((r) => r.user_id).filter((id): id is string => typeof id === 'string');
  }

  // Publikum podle SEKCE povrchu: příjemcem je ten, kdo tu sekci SMÍ VIDĚT.
  // Rozhoduje `surface_audience_allows` v databázi — TÝŽ predikát, podle kterého
  // se sekce zobrazuje. Služba tu vědomě NEMÁ vlastní úsudek o oprávnění:
  // druhý rozhodovač by se s prvním dřív nebo později rozešel.
  //
  // ⛔ Chybějící `section` vrací prázdno (kampaň je špatně vyplněná), ale
  // NEEXISTUJÍCÍ sekce vyhodí — to rozlišení dělá RPC, ne tenhle kód: „poslalo
  // se to nikomu" a „sekce se jmenuje jinak" jsou dvě různé věci.
  if (campaign.audience_type === 'surface_section') {
    const sekce = typeof filter.section === 'string' ? filter.section : null;
    if (!sekce) return [];
    const data = await rpcService<{ rows?: Array<{ user_id?: string }> } | null>('edge_notification_campaigns', {
      p_action: 'get_section_audience_user_ids',
      p_payload: { section: sekce },
    });
    return (data?.rows ?? []).map((r) => r.user_id).filter((id): id is string => typeof id === 'string');
  }

  if (campaign.audience_type === 'user_list') {
    return Array.isArray(filter.user_ids)
      ? (filter.user_ids as string[]).filter((id) => typeof id === 'string')
      : [];
  }

  // Default: all users
  const data = await rpcService<{ rows?: Array<{ user_id?: string }> } | null>('edge_notification_campaigns', {
    p_action: 'get_all_profile_user_ids',
    p_payload: {},
  });
  return (data?.rows ?? []).map((r) => r.user_id).filter((id): id is string => typeof id === 'string');
}

export async function campaignsRoute(app: FastifyInstance): Promise<void> {
  /**
   * POST /campaigns/process — triggered by cron.
   * Processes due campaign schedules and sends notifications.
   */
  app.post('/campaigns/process', async (req: FastifyRequest, reply: FastifyReply) => {
    // Cron-triggered worker route — service-role token required (least privilege).
    try {
      verifyServiceRole(req.headers.authorization);
    } catch (err) {
      const status = err instanceof AuthError ? err.statusCode : 401;
      return reply.status(status).send({ error: 'Unauthorized' });
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const today = nowIso.split('T')[0];

    const schedulesResult = await rpcService<{ rows?: ScheduleRow[] } | null>('edge_notification_campaigns', {
      p_action: 'get_due_schedules',
      p_payload: { now: nowIso },
    });
    const schedules = schedulesResult?.rows ?? [];

    if (schedules.length === 0) {
      return reply.send({ success: true, processed: 0 });
    }

    const campaignIds = [...new Set(schedules.map((s) => s.campaign_id))];
    const campaignsResult = await rpcService<{ rows?: CampaignRow[] } | null>('edge_notification_campaigns', {
      p_action: 'get_campaigns',
      p_payload: { campaign_ids: campaignIds },
    });
    const campaignMap = new Map<string, CampaignRow>();
    for (const c of campaignsResult?.rows ?? []) {
      campaignMap.set(c.id, c);
    }

    let processed = 0;
    const results: Array<{ schedule_id: string; status: string }> = [];

    for (const schedule of schedules) {
      const campaign = campaignMap.get(schedule.campaign_id);
      if (!campaign) {
        await rpcService('edge_notification_campaigns', {
          p_action: 'update_schedule',
          p_payload: { last_run_at: nowIso, schedule_id: schedule.id, status: 'completed' },
        });
        results.push({ schedule_id: schedule.id, status: 'skipped' });
        continue;
      }

      const claimResult = await rpcService<{ claimed?: boolean } | null>('edge_notification_campaigns', {
        p_action: 'claim_schedule',
        p_payload: { now: nowIso, schedule_id: schedule.id },
      });
      if (!claimResult?.claimed) continue;

      const errors: string[] = [];

      try {
        const targetIdsRaw = await resolveTargets(campaign, nowIso, today);
        const targetUserIds = [...new Set(targetIdsRaw)];

        if (targetUserIds.length === 0) {
          await rpcService('edge_notification_campaigns', {
            p_action: 'insert_run',
            p_payload: {
              campaign_id: campaign.id, inapp_sent: 0, push_sent: 0,
              recipients_count: 0, run_at: nowIso, schedule_id: schedule.id, status: 'sent',
            },
          });
        } else {
          // Get user preferences
          const prefsResult = await rpcService<{ rows?: NotificationPreferences[] } | null>('edge_mobile_notifications', {
            p_action: 'get_notification_preferences',
            p_payload: { user_ids: targetUserIds },
          });
          const prefsMap = new Map<string, NotificationPreferences>();
          for (const row of prefsResult?.rows ?? []) prefsMap.set(row.user_id, row);

          const pushUserIds = campaign.send_push
            ? targetUserIds.filter((id) => shouldSendNow(prefsMap.get(id), now))
            : [];
          const inappUserIds = campaign.send_inapp ? targetUserIds : [];

          // Get user locales
          const profilesResult = await rpcService<{ rows?: Array<{ user_id: string; preferred_language: string | null }> } | null>(
            'edge_profiles',
            { p_action: 'get_languages', p_payload: { user_ids: targetUserIds } },
          );
          const localeMap = new Map<string, string>();
          for (const row of profilesResult?.rows ?? []) {
            localeMap.set(row.user_id, row.preferred_language || campaign.base_locale);
          }

          const groupByLocale = (ids: string[]) => {
            const groups = new Map<string, string[]>();
            for (const id of ids) {
              const locale = localeMap.get(id) || campaign.base_locale || 'en';
              const list = groups.get(locale) ?? [];
              list.push(id);
              groups.set(locale, list);
            }
            return groups;
          };

          let inappCount = 0;
          let pushCount = 0;
          let pushFailedCount = 0;

          // In-app notifications
          for (const [locale, ids] of groupByLocale(inappUserIds).entries()) {
            const translations = await rpcService<Array<{ key: string; value: string }> | null>(
              'get_translations_map_with_fallback',
              {
                p_fallback_locale: campaign.base_locale || 'en',
                p_keys: [campaign.title_key, campaign.body_key],
                p_locale: locale,
                p_namespace: 'notifications',
              },
            );

            const tMap = new Map<string, string>();
            for (const row of translations ?? []) tMap.set(row.key, row.value);

            const title = tMap.get(campaign.title_key) || campaign.title_key;
            const body = tMap.get(campaign.body_key) || campaign.body_key;

            const rows = ids.map((user_id) => ({
              link: campaign.link,
              message: body,
              metadata: { campaign_id: campaign.id, schedule_id: schedule.id },
              title, type: 'campaign', user_id,
            }));

            for (const batch of chunk(rows, 500)) {
              try {
                await rpcService('edge_mobile_notifications', {
                  p_action: 'insert_notifications_bulk',
                  p_payload: { rows: batch },
                });
                inappCount += batch.length;
              } catch {
                errors.push('inapp_insert_failed');
              }
            }
          }

          // Push notifications — call our own /send endpoint internally
          for (const [locale, ids] of groupByLocale(pushUserIds).entries()) {
            const translations = await rpcService<Array<{ key: string; value: string }> | null>(
              'get_translations_map_with_fallback',
              {
                p_fallback_locale: campaign.base_locale || 'en',
                p_keys: [campaign.title_key, campaign.body_key],
                p_locale: locale,
                p_namespace: 'notifications',
              },
            );

            const tMap = new Map<string, string>();
            for (const row of translations ?? []) tMap.set(row.key, row.value);

            const title = tMap.get(campaign.title_key) || campaign.title_key;
            const body = tMap.get(campaign.body_key) || campaign.body_key;

            // Call our own /send endpoint via localhost
            try {
              const res = await fetch(`http://localhost:${config.port}/send`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${config.postgrestServiceToken}`,
                },
                body: JSON.stringify({
                  user_ids: ids, title, body,
                  send_mobile: true, send_web: true,
                  data: normalizePayloadData(campaign.data, {
                    campaign_id: campaign.id,
                    schedule_id: schedule.id,
                  }),
                }),
                signal: AbortSignal.timeout(15_000),
              });

              if (res.ok) {
                const result = (await res.json()) as { sent?: number; failed?: number };
                pushCount += result?.sent ?? 0;
                pushFailedCount += result?.failed ?? 0;
              } else {
                errors.push('push_failed');
              }
            } catch {
              errors.push('push_failed');
            }
          }

          const totalRecipients = new Set([...inappUserIds, ...pushUserIds]).size;

          await rpcService('edge_notification_campaigns', {
            p_action: 'insert_run',
            p_payload: {
              campaign_id: campaign.id,
              errors: errors.length > 0 ? errors : null,
              inapp_sent: inappCount,
              push_sent: pushCount,
              recipients_count: totalRecipients,
              run_at: nowIso,
              schedule_id: schedule.id,
              status: errors.length > 0 || pushFailedCount > 0 ? 'partial' : 'sent',
            },
          });
        }

        // Update schedule
        const nextRunAt = schedule.repeat_interval_minutes
          ? new Date(now.getTime() + schedule.repeat_interval_minutes * 60_000).toISOString()
          : schedule.next_run_at;
        const nextStatus = schedule.repeat_interval_minutes ? 'scheduled' : 'completed';

        await rpcService('edge_notification_campaigns', {
          p_action: 'update_schedule',
          p_payload: { last_run_at: nowIso, next_run_at: nextRunAt, schedule_id: schedule.id, status: nextStatus },
        });

        processed += 1;
        results.push({ schedule_id: schedule.id, status: nextStatus });
      } catch {
        await rpcService('edge_notification_campaigns', {
          p_action: 'update_schedule',
          p_payload: { last_run_at: nowIso, schedule_id: schedule.id, status: 'failed' },
        });
        results.push({ schedule_id: schedule.id, status: 'failed' });
      }
    }

    return reply.send({ success: true, processed, results });
  });
}
