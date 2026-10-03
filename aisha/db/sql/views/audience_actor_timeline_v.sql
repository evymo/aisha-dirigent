-- View: public.audience_actor_timeline_v
-- Unified chronological timeline per actor (story entries + audit + communications).

CREATE OR REPLACE VIEW public.audience_actor_timeline_v AS
 SELECT ps.user_id AS actor_user_id,
    se.id AS event_id,
    'story_entry'::text AS event_source,
    se.entry_type AS event_type,
    se.content,
    se.metadata,
    se.created_by,
    COALESCE(se.occurred_at, se.created_at) AS occurred_at
   FROM story_entries se
     JOIN partner_stories ps ON ps.id = se.story_id
UNION ALL
 SELECT aj.user_id AS actor_user_id,
    aj.id AS event_id,
    'audit'::text AS event_source,
    aj.action AS event_type,
    aj.summary AS content,
    aj.details AS metadata,
    aj.user_id AS created_by,
    aj.created_at AS occurred_at
   FROM audit_journal aj
  WHERE aj.area = ANY (ARRAY['outreach'::text, 'crm_ops'::text, 'crm'::text])
UNION ALL
 SELECT o.user_id AS actor_user_id,
    o.id AS event_id,
    'communication'::text AS event_source,
    o.channel AS event_type,
    COALESCE(o.payload ->> 'title_key'::text, o.payload ->> 'description'::text, o.template) AS content,
    jsonb_build_object('campaign_id', o.campaign_id, 'status', o.status, 'opened_at', o.opened_at, 'clicked_at', o.clicked_at, 'recipient', o.recipient, 'template', o.template) AS metadata,
    o.created_by,
    o.created_at AS occurred_at
   FROM openclaw_notifications o
  WHERE o.user_id IS NOT NULL;

COMMENT ON VIEW public.audience_actor_timeline_v IS
  'Unified chronological timeline per actor. UNION of story_entries (manual
   notes), openclaw_notifications (outbound communications), and audit_journal
   (system events with CRM relevance). Single source for "Communication
   timeline" UI panel. RLS filtering happens at underlying table level.';
