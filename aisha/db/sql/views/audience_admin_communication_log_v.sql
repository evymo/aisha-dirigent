-- View: public.audience_admin_communication_log_v
-- Unified communication history with campaign + engagement outcome.

CREATE OR REPLACE VIEW public.audience_admin_communication_log_v AS
 SELECT o.user_id AS actor_user_id,
    p.display_name AS actor_name,
    p.email AS actor_email,
    o.id AS communication_id,
    o.channel,
    o.status,
    COALESCE(o.payload ->> 'title_key'::text, o.payload ->> 'subject'::text) AS title,
    COALESCE(o.payload ->> 'body_key'::text, o.payload ->> 'description'::text, o.payload ->> 'message'::text) AS body,
    o.recipient,
    o.template,
    o.campaign_id,
    nc.name AS campaign_name,
    o.created_at AS sent_at,
    o.opened_at,
    o.clicked_at,
    o.bounced_at,
    o.unsubscribed_at,
        CASE
            WHEN o.unsubscribed_at IS NOT NULL THEN 'unsubscribed'::text
            WHEN o.bounced_at IS NOT NULL THEN 'bounced'::text
            WHEN o.clicked_at IS NOT NULL THEN 'clicked'::text
            WHEN o.opened_at IS NOT NULL THEN 'opened'::text
            WHEN o.status = ANY (ARRAY['sent'::text, 'sending'::text]) THEN 'delivered'::text
            ELSE o.status
        END AS engagement_outcome
   FROM openclaw_notifications o
     LEFT JOIN profiles p ON p.user_id = o.user_id
     LEFT JOIN notification_campaigns nc ON nc.id = o.campaign_id
  ORDER BY o.created_at DESC;

COMMENT ON VIEW public.audience_admin_communication_log_v IS
  'Unified communication history: every openclaw_notifications row with
   campaign + engagement outcome. Filterable per-actor for timeline UI.';
