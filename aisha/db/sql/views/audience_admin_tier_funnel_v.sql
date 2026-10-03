-- View: public.audience_admin_tier_funnel_v
-- Tier funnel KPIs (actor counts per tier, recently active, with audience).

CREATE OR REPLACE VIEW public.audience_admin_tier_funnel_v AS
 SELECT member_tier,
    count(*) AS actor_count,
    count(*) FILTER (WHERE last_active_at > (now() - '30 days'::interval)) AS active_30d,
    count(*) FILTER (WHERE last_active_at > (now() - '7 days'::interval)) AS active_7d,
    count(*) FILTER (WHERE audience_size > 0) AS with_audience,
    round(avg(audience_size), 2) AS avg_audience_size
   FROM audience_actor_tier_v
  GROUP BY member_tier;

COMMENT ON VIEW public.audience_admin_tier_funnel_v IS
  'Tier funnel KPIs: how many actors at each tier, recently active,
   with audience. Drives Appsmith "Tier Funnel" dashboard.';
