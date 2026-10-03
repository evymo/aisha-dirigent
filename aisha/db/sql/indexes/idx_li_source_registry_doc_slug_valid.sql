-- ============================================================================
-- Index: idx_li_source_registry_doc_slug_valid — ukazatel běhu → řádek registru
--
-- PROČ: fronta předání se od 2026-09-25 neptá zmrazené kopie v `input_data`,
-- ale UKAZATELE (`doc_slug`) na registr — co zdroj říká DNES. Join je laterál
-- per řádek fronty (`get_workflow_my_steps_block`), takže při stropu 200
-- položek jde o 200 dohledání.
--
-- Bez indexu je každé z nich Seq Scan: `doc_slug` je sice NOT NULL a fakticky
-- klíč, ale UNIQUE má jen `source_sha256` a PK je `id` — změřeno na čerstvém
-- baseline 2026-09-25: li_source_registry má 8 indexů a ANI JEDEN nesahá na
-- `doc_slug`. Na produkčním registru (~43 tis. řádků) je to 200 × celý průchod.
--
-- PARCIÁLNÍ (`superseded_by IS NULL`): dotaz se ptá VÝHRADNĚ na platnou verzi
-- dokladu — supersedované řádky jsou historie, kterou fronta nikdy nehledá.
-- Index je tím menší a vejde se do cache i s registrem, který roste.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_li_source_registry_doc_slug_valid
  ON public.li_source_registry (doc_slug)
  WHERE superseded_by IS NULL;
