-- View: public.audience_admin_source_event_monthly_v
-- Agregát pro GRAF nových událostí po měsících — viz topic_monthly_v.
CREATE OR REPLACE VIEW public.audience_admin_source_event_monthly_v AS
SELECT month, items_count, follows_total, withdrawn_count, official_count, online_count
FROM public.audience_admin_source_stats_monthly_v
WHERE kind = 'event';
COMMENT ON VIEW public.audience_admin_source_event_monthly_v IS
  'Events created per month (chart source). Admin/staff.';

-- ⛔ Pohled s právy vlastníka (mimo RLS podkladu) — čte se JEN přes DEFINER
-- blokové funkce get_audience_view_*_block (is_admin_or_staff + jmenný prostor
-- audience_admin_*_v). Přímý grant klientské roli tu stráž obchází (nález
-- 2026-10-04); REVOKE i z authenticated kvůli explicitním grantům z heals
-- a default privileges na běžící DB.
REVOKE ALL ON public.audience_admin_source_event_monthly_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.audience_admin_source_event_monthly_v TO service_role;
