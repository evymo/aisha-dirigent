-- View: public.audience_admin_campaign_performance_v
-- Per-campaign performance dashboard (channels, latest run, per-channel breakdown).

CREATE OR REPLACE VIEW public.audience_admin_campaign_performance_v AS
 SELECT id AS campaign_id,
    name AS campaign_name,
    description,
    is_active,
    channels,
    audience_type,
    audience_filter,
    created_at,
    ( SELECT row_to_json(runs.*) AS row_to_json
           FROM ( SELECT notification_campaign_runs.run_at,
                    notification_campaign_runs.status,
                    notification_campaign_runs.recipients_count,
                    notification_campaign_runs.push_sent,
                    notification_campaign_runs.inapp_sent
                   FROM notification_campaign_runs
                  WHERE notification_campaign_runs.campaign_id = nc.id
                  ORDER BY notification_campaign_runs.run_at DESC
                 LIMIT 1) runs) AS latest_run,
    ( SELECT jsonb_object_agg(per_channel.channel, per_channel.stats) AS jsonb_object_agg
           FROM ( SELECT openclaw_notifications.channel,
                    jsonb_build_object('queued', count(*) FILTER (WHERE openclaw_notifications.status = 'queued'::text), 'sent', count(*) FILTER (WHERE openclaw_notifications.status = ANY (ARRAY['sent'::text, 'sending'::text])), 'opened', count(openclaw_notifications.opened_at), 'clicked', count(openclaw_notifications.clicked_at), 'bounced', count(openclaw_notifications.bounced_at), 'unsubscribed', count(openclaw_notifications.unsubscribed_at)) AS stats
                   FROM openclaw_notifications
                  WHERE openclaw_notifications.campaign_id = nc.id
                  GROUP BY openclaw_notifications.channel) per_channel) AS per_channel_stats,
    ( SELECT count(DISTINCT openclaw_notifications.user_id) AS count
           FROM openclaw_notifications
          WHERE openclaw_notifications.campaign_id = nc.id) AS total_recipients,
    ( SELECT count(*)::numeric / NULLIF(count(*), 0)::numeric
           FROM openclaw_notifications
          WHERE openclaw_notifications.campaign_id = nc.id AND openclaw_notifications.opened_at IS NOT NULL) AS open_rate
   FROM notification_campaigns nc;

COMMENT ON VIEW public.audience_admin_campaign_performance_v IS
  'Per-campaign performance dashboard. Channels[], latest run, per-channel
   delivery + engagement breakdown. Drives Appsmith "Campaign Performance".';
