-- View: public.audience_admin_source_event_monthly_v
-- Agregát pro GRAF nových událostí po měsících — viz topic_monthly_v.
CREATE OR REPLACE VIEW public.audience_admin_source_event_monthly_v AS
SELECT month, items_count, follows_total, withdrawn_count, official_count, online_count
FROM public.audience_admin_source_stats_monthly_v
WHERE kind = 'event';
COMMENT ON VIEW public.audience_admin_source_event_monthly_v IS
  'Events created per month (chart source). Admin/staff.';
