-- View: public.audience_admin_source_topic_stats_v
-- Témata vzniklá v měsíci — tvar CSV exportu operátora (Topic ID; title;
-- created by; deleted; private; follows; posts; tags), plus `month` pro filtr.
-- ⛔ BOOLEANY JAKO TEXT ('true'/'false'): maska tabulky boolean NEPŘIPOUŠTÍ a
-- jeden takový 2026-09-07 shodil celý detail dvojčete. Jsou to strojové hodnoty
-- ze zdroje (jako `email`/`meeting` u druhu události) — vypíší se rovnou a
-- překlad se dá přidat NAD ně, aniž se sáhne do dat.
-- ⛔ Sloupce jen PŘIDÁVAT NA KONEC (CREATE OR REPLACE VIEW).
CREATE OR REPLACE VIEW public.audience_admin_source_topic_stats_v AS
SELECT
  s.month,
  s.external_id                                   AS topic_id,
  s.title,
  s.created_by,
  s.created_at,
  CASE WHEN s.deleted    THEN 'true' ELSE 'false' END AS deleted,
  CASE WHEN s.is_private THEN 'true' ELSE 'false' END AS private,
  s.follow_count,
  s.posts_count,
  s.tags,
  s.source_slug,
  s.synced_at,
  -- ⛔ NA KONEC, NE DOPROSTŘED. `CREATE OR REPLACE VIEW` umí sloupce jen PŘIDAT
  -- za poslední; vložení doprostřed je pro Postgres PŘEJMENOVÁNÍ a v provozu
  -- spadne (naměřeno 2026-09-06, API 502 na 9 minut). Hlídá brána
  -- `pohled-jde-nahradit`, která nechá o slučitelnosti rozhodnout sám Postgres.
  s.created_by_id
FROM public.source_period_stats s
WHERE s.kind = 'topic';
COMMENT ON VIEW public.audience_admin_source_topic_stats_v IS
  'Topics created per month (operator export shape). Filter by month (YYYY-MM). Admin/staff via get_audience_view_*_block.';
