-- Policy: twin_entities_read — čtení twin substrátu (admin/staff)
-- Source of truth pair: aisha/db/sql/tables/twin_entities.sql
--
-- Predikát obalen do poddotazu → InitPlan: vyhodnotí se JEDNOU za dotaz, ne pro
-- každý řádek. Změřeno na produkci 2026-07-30 večer (2 716–2 725 řádků, tabulka
-- ŽIVĚ roste ingestem): plný průchod pod authenticated 704 ms → 57 ms; blok
-- get_twin_register (Registry sekce extranetu, 5 bloků á ~1 s v prohlížeči)
-- 813 ms → 76–107 ms. Uvnitř SQL funkce je entity_type VÝRAZ nad parametrem,
-- takže si planner smí zvolit seq scan — per-row policy pak platí celou
-- tabulku; InitPlan tvar je vůči volbě plánu robustní a drží konstantní cenu
-- i s růstem dat.
--
-- Nárok NEZMĚNĚN — doloženo v JEDNOM repeatable-read snapshotu (živý ingest
-- mezi transakcemi mění počty, srovnání napříč transakcemi je proto neplatné):
--   admin 2 725 / md5 2835b717070201c6fd2964881c521be7 před i po
--   identita bez rolí 0 / 0
-- Táž třída jako li_source_registry_read (#46) a production_workflow_steps (#55).

-- ⭐ NÁROK Z VAZEB (rozhodnutí majitele 2026-09-28): kromě správy čte i uživatel
-- spojený vazbou s identitou — jen dvojčata ve svém rozsahu (twin_ids_v_rozsahu:
-- identity, vlastní osoba, protistrany dokladů v rozsahu). Množinově (InitPlan),
-- bez vazby prázdno. Karta dlužníka a síť vazeb jsou SECURITY INVOKER a bez
-- tohoto členu by běžnému uživateli ukázaly faktury, ale prázdnou kartu.

DROP POLICY IF EXISTS twin_entities_read ON public.twin_entities;
CREATE POLICY twin_entities_read ON public.twin_entities
  FOR SELECT USING (
    (SELECT public.is_admin_or_staff())
    OR (SELECT public.ma_plny_pristup_k_datum((SELECT auth.uid())))
    OR id IN (SELECT public.twin_ids_v_rozsahu((SELECT auth.uid())))
  );
