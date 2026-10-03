-- ============================================================================
-- Index: idx_twin_relations_target_range — sjezd K DATU (historické dotazy)
-- ============================================================================
-- Sesterské indexy jsou ČÁSTEČNÉ (jen aktivní hrany) a k historickému dotazu
-- jsou tedy slepé. Přitom celý smysl hran s platností je otázka „kdo patřil pod
-- tenhle uzel K ROZHODNÉMU DNI" — elektorát hlasování, publikum k datu, nárok
-- v období. Ten dotaz je rozsahový, ne rovnostní.
--
-- GiST + tstzrange: predikát sjezdu je `valid_from <= p_at < COALESCE(valid_to,
-- ∞)`, což je test PRŮNIKU intervalu s okamžikem. btree nad dvěma sloupci to
-- neumí obsloužit jedním průchodem, rozsahový GiST ano.
--
-- Vyžaduje btree_gist pro rovnostní část nad uuid (v baseline je) — táž
-- závislost jako EXCLUDE constraint na téže tabulce.
CREATE INDEX IF NOT EXISTS idx_twin_relations_target_range
  ON public.twin_relations USING gist (target_twin_id, tstzrange(valid_from, valid_to, '[)'));
