-- Policy: twin_relations_read — čtení hran twinsverse (admin/staff)
-- Source of truth pair: aisha/db/sql/tables/twin_relations.sql
--
-- Zrcadlí twin_entities_read: substrát čtou admin/staff; širší publikum se
-- k hranám dostává výhradně přes bloky a odvozovací funkce (SECURITY INVOKER
-- descendants dědí tenhle predikát, definer RPC si nárok hlídají samy).
--
-- Predikát obalen do poddotazu → InitPlan: vyhodnotí se JEDNOU za dotaz, ne
-- pro každý řádek. Táž třída jako twin_entities_read (naměřeno tam:
-- 704 ms → 57 ms) — hranová tabulka poroste rychleji než entity (N hran na
-- entitu), takže per-row tvar by tu bolel dřív.
-- ⭐ NÁROK Z VAZEB (rozhodnutí majitele 2026-09-28): kromě správy čte i uživatel
-- spojený vazbou s identitou — jen dvojčata ve svém rozsahu (twin_ids_v_rozsahu:
-- identity, vlastní osoba, protistrany dokladů v rozsahu). Množinově (InitPlan),
-- bez vazby prázdno. Karta dlužníka a síť vazeb jsou SECURITY INVOKER a bez
-- tohoto členu by běžnému uživateli ukázaly faktury, ale prázdnou kartu.
-- ⛔ Hrana jen když jsou v rozsahu OBA konce: vlastní vazba osoba → identita ano,
-- vazba JINÉ osoby na tutéž identitu ne (kdo další co spravuje, není jeho nárok).

DROP POLICY IF EXISTS twin_relations_read ON public.twin_relations;
CREATE POLICY twin_relations_read ON public.twin_relations
  FOR SELECT USING (
    (SELECT public.is_admin_or_staff())
    OR (SELECT public.ma_plny_pristup_k_datum((SELECT auth.uid())))
    -- Jedno pole v InitPlanu, ne dvě IN: rozsah se počítá přes doklady a dvakrát
    -- za dotaz by stál dvojnásob.
    OR ARRAY[source_twin_id, target_twin_id] <@ (
      SELECT coalesce(array_agg(x), '{}'::uuid[])
        FROM public.twin_ids_v_rozsahu((SELECT auth.uid())) AS x
    )
  );
