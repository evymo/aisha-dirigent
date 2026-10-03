-- View: public.audience_admin_source_topic_monthly_v
-- Agregát pro GRAF nových témat po měsících. Zvláštní pohled místo filtru
-- v konfiguraci bloku: get_audience_view_chart_block filtry NEUMÍ (ověřeno
-- 2026-09-08), takže filtr `kind` v configu by se tiše ignoroval a graf by
-- smíchal témata s událostmi — zelené nasazení, špatné číslo. Pohled je
-- jediné místo, kde se druh vybírá, a nedá se obejít konfigurací.
CREATE OR REPLACE VIEW public.audience_admin_source_topic_monthly_v AS
SELECT month, items_count, follows_total, withdrawn_count, official_count, online_count
FROM public.audience_admin_source_stats_monthly_v
WHERE kind = 'topic';
COMMENT ON VIEW public.audience_admin_source_topic_monthly_v IS
  'Topics created per month (chart source). Admin/staff.';
