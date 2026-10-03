-- ============================================================================
-- Index: idx_li_source_registry_id_text  — funkční index na (id)::text
--
-- PROČ: `twin_external_refs.source_key` je TEXT (klíč ve zdrojovém systému), a
-- generické review bloky se na registr připojují textově:
--     left join li_source_registry li on li.id::text = r.source_key
--         (get_twin_ref_review_block, get_doc_expiry_review_block)
-- Cast na levé straně znemožní použití primárního klíče → Seq Scan přes 43 157
-- řádků, u pd_review dokonce 33× (jednou za twin entitu). Změřeno na produkci:
--     join samotný        886 ms  →  0,55 ms
--     blok pd_review      673 ms  →  5,1 ms   (132×)
--     blok pd_recommend   576 ms  →  3,1 ms   (186×)
--
-- PROČ INDEX A NE PŘEPIS JOINU: `li.id = r.source_key::uuid` je v mikro-testu
-- ještě o zlomek rychlejší, ale ROZBILO by generický blok — `source_key` UUID
-- být nemusí. Změřeno v twin_external_refs: li-contracts 14/14 UUID, ale
-- jiný zdroj 0/37 (klíče jsou názvy firem a lokalit) a webdispecink
-- 0/1. Blok bere `source` z konfigurace, takže cast by vyhodil chybu, jakmile
-- by se nakonfiguroval na rentroll. Index dá týž Index Scan a join zůstane
-- textový — tedy tolerantní k jakémukoli tvaru cizího klíče.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_li_source_registry_id_text
  ON public.li_source_registry (((id)::text));
