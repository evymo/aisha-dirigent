-- Policy: twin_external_refs_read
-- Source of truth pair: aisha/db/sql/tables/twin_external_refs.sql
-- Predikát v InitPlanu (2026-07-30): tabulka narostla na 5 745 řádků a EXISTS
-- do ní jezdí z workflow viditelnosti — per-row is_admin_or_staff ji zdražoval
-- pro každé přímé čtení pod authenticated. Nárok beze změny.

-- ⭐ NÁROK Z VAZEB (rozhodnutí majitele 2026-09-28): kromě správy čte i uživatel
-- spojený vazbou s identitou — jen dvojčata ve svém rozsahu (twin_ids_v_rozsahu:
-- identity, vlastní osoba, protistrany dokladů v rozsahu). Množinově (InitPlan),
-- bez vazby prázdno. Karta dlužníka a síť vazeb jsou SECURITY INVOKER a bez
-- tohoto členu by běžnému uživateli ukázaly faktury, ale prázdnou kartu.
-- ⛔ Vazby ÚČTŮ (ref_kind='account', klíč = id uživatele) běžnému uživateli ne.

DROP POLICY IF EXISTS twin_external_refs_read ON public.twin_external_refs;
CREATE POLICY twin_external_refs_read ON public.twin_external_refs
  FOR SELECT USING (
    (SELECT public.is_admin_or_staff())
    -- plný přístup k datům: identifikátory ano, vazby ÚČTŮ (kdo je čí uživatel) ne
    OR (ref_kind <> 'account' AND (SELECT public.ma_plny_pristup_k_datum((SELECT auth.uid()))))
    OR (ref_kind <> 'account'
        AND twin_id IN (SELECT public.twin_ids_v_rozsahu((SELECT auth.uid()))))
  );
