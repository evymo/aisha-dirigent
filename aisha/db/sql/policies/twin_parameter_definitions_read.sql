-- Policy: twin_parameter_definitions_read — čtení definic parametrů (admin/staff)
-- Source of truth pair: aisha/db/sql/tables/twin_parameter_definitions.sql
--
-- Predikát v poddotazu → InitPlan. Definice jsou dnes malé (14 na typ), ale
-- get_twin_register je čte v témž dotazu jako twin_entities/twin_events —
-- a per-row authz pomocník je táž třída bez ohledu na dnešní velikost (viz
-- twin_entities_read.sql: registry blok 813 → 76–107 ms). Doktrína: authz
-- predikát nezávislý na řádku patří do InitPlanu vždy, ne až když tabulka
-- naroste — brána rls-predikat-a-indexy to vynucuje na každé změně souboru.

DROP POLICY IF EXISTS twin_parameter_definitions_read ON public.twin_parameter_definitions;
CREATE POLICY twin_parameter_definitions_read ON public.twin_parameter_definitions
  -- katalog parametrů čte i plný přístup k datům (popisky sloupců registru dvojčat)
  FOR SELECT USING ((SELECT public.is_admin_or_staff()) OR (SELECT public.ma_plny_pristup_k_datum((SELECT auth.uid())))
                    OR (SELECT public.ma_zdroj_dat((SELECT auth.uid()))));
