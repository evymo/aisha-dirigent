-- View: public.audience_admin_activities_v
-- Lovable-compat: CRM activity feed projection over audience_actor_timeline_v.

CREATE OR REPLACE VIEW public.audience_admin_activities_v AS
 SELECT actor_user_id,
    event_type,
    event_source,
    content,
    occurred_at,
    created_by
   FROM audience_actor_timeline_v t;
