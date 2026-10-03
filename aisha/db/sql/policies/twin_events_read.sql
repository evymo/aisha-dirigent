-- Policy: twin_events_read — čtení twin událostí (admin/staff)
-- Source of truth pair: aisha/db/sql/tables/twin_events.sql
--
-- Predikát v poddotazu → InitPlan (jedno vyhodnocení za dotaz). Sesterská
-- oprava k twin_entities_read — get_twin_register čte oboje v JEDNOM dotazu
-- a per-row policy na kterékoli straně joinu platí celou relaci; events
-- porostou s telematikou rychleji než entity. Měřený kontext je
-- v twin_entities_read.sql (registry blok 813 → 76–107 ms).
--
-- Nárok nezměněn: events 50 / md5 1f47160d7d6d2f704b998ff8c1b534bb před i po
-- (repeatable-read snapshot, admin i identita bez rolí).

DROP POLICY IF EXISTS twin_events_read ON public.twin_events;
CREATE POLICY twin_events_read ON public.twin_events
  -- plný přístup k datům (2026-09-28): parametry v čase (nájemce, obsazenost jednotky…)
  -- udělený rozsah (vazby, zdroje dat, zdroje dvojčat): parametry v čase dvojčat, která smí
  -- číst (nájemce a obsazenost jednotky, sídlo protistrany…) — 2026-09-28
  FOR SELECT USING ((SELECT public.is_admin_or_staff()) OR (SELECT public.ma_plny_pristup_k_datum((SELECT auth.uid())))
                    OR twin_id IN (SELECT public.twin_ids_v_rozsahu((SELECT auth.uid()))));
