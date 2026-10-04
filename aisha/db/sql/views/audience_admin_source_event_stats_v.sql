-- View: public.audience_admin_source_event_stats_v
-- Události vzniklé v měsíci — tvar CSV exportu (Event ID; title; created by;
-- date from/to; official; cancelled; online; follows; tags) + `month`.
-- Booleany jako text a sloupce jen na konec — viz topic_stats_v.
CREATE OR REPLACE VIEW public.audience_admin_source_event_stats_v AS
SELECT
  s.month,
  s.external_id                                   AS event_id,
  s.title,
  s.created_by,
  s.created_at,
  s.date_from,
  s.date_to,
  CASE WHEN s.official  THEN 'true' ELSE 'false' END AS official,
  CASE WHEN s.cancelled THEN 'true' ELSE 'false' END AS cancelled,
  CASE WHEN s.online    THEN 'true' ELSE 'false' END AS online,
  s.follow_count,
  s.tags,
  s.source_slug,
  s.synced_at,
  -- ⛔ NA KONEC, NE DOPROSTŘED. `CREATE OR REPLACE VIEW` umí sloupce jen PŘIDAT
  -- za poslední; vložení doprostřed je pro Postgres PŘEJMENOVÁNÍ a v provozu
  -- spadne (naměřeno 2026-09-06, API 502 na 9 minut). Hlídá brána
  -- `pohled-jde-nahradit`, která nechá o slučitelnosti rozhodnout sám Postgres.
  s.created_by_id
FROM public.source_period_stats s
WHERE s.kind = 'event';
COMMENT ON VIEW public.audience_admin_source_event_stats_v IS
  'Events created per month (operator export shape). Filter by month (YYYY-MM). Admin/staff via get_audience_view_*_block.';

-- ⛔ Pohled s právy vlastníka (mimo RLS podkladu) — čte se JEN přes DEFINER
-- blokové funkce get_audience_view_*_block (is_admin_or_staff + jmenný prostor
-- audience_admin_*_v). Přímý grant klientské roli tu stráž obchází (nález
-- 2026-10-04); REVOKE i z authenticated kvůli explicitním grantům z heals
-- a default privileges na běžící DB.
REVOKE ALL ON public.audience_admin_source_event_stats_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.audience_admin_source_event_stats_v TO service_role;
