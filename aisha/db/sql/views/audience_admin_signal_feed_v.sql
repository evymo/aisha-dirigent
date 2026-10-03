-- View: public.audience_admin_signal_feed_v
-- Recent signals across all sources with resolved actor + rule-applied tags.

CREATE OR REPLACE VIEW public.audience_admin_signal_feed_v AS
 SELECT id AS event_id,
    event_source,
    event_type,
    status,
    story_id,
    metadata,
    routed_to,
    created_at,
    COALESCE((metadata ->> 'user_id'::text)::uuid, (metadata ->> 'actor_user_id'::text)::uuid, (metadata ->> 'profile_id'::text)::uuid) AS actor_user_id,
    ( SELECT array_agg(DISTINCT unnest_tags.unnest_tags) AS array_agg
           FROM signal_tag_rules,
            LATERAL unnest(signal_tag_rules.tags) unnest_tags(unnest_tags)
          WHERE signal_tag_rules.is_active AND ie.event_type ~ signal_tag_rules.event_type_pattern AND (signal_tag_rules.source_pattern IS NULL OR ie.event_source ~ signal_tag_rules.source_pattern)) AS would_apply_tags
   FROM integration_events ie
  ORDER BY created_at DESC;

COMMENT ON VIEW public.audience_admin_signal_feed_v IS
  'Recent signals across all data sources with resolved actor + tags that
   would be applied by rules. Used for debugging + audit + understanding
   signal flow. Drives Appsmith "Signal Feed" page.';
