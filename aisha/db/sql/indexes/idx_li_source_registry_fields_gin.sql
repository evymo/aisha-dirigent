-- ============================================================================
-- Index: idx_li_source_registry_fields_gin — identita dokladu VE ZDROJI, obecně
--
-- PROČ: `get_workflow_my_steps_block` (source_state) hledá aktuální verzi
-- dokladu, když ukazatel `doc_slug` v běhu už nemíří na platný řádek — registr
-- je content-addressed, takže ZMĚNĚNÝ doklad dostane nový slug a stará generace
-- je `superseded_by` nebo odstraněná dedupem. Druhý dotaz jde přes IDENTITU
-- dokladu ve zdroji, a KTERÉ pole ji nese, je DATA instance
-- (`source_state.stable_key`), ne vlastnost platformy — stejné pravidlo jako
-- identity map u `li_dedupe_source_registry`.
--
-- PROČ GIN A NE BTREE VÝRAZ: btree výrazový index (`(fields->'<pole>'->>'value')`)
-- musí mít jméno pole natvrdo — instanční slovo v SQL platformy, a hlavně
-- nepoužitelný, když jméno přichází parametrem. GIN `jsonb_path_ops` obslouží
-- obsažení `fields @> {"<pole>": {"value": "<hodnota>"}}` pro LIBOVOLNÉ pole
-- jedním indexem.
--
-- Změřeno 2026-09-26 (PG 18, syntetický registr 43 000 řádků × 20 polí,
-- 40 000 kroků, polovina s neplatným ukazatelem), proti btree výrazu na jednom
-- pevném poli: index 15 MB proti 2,5 MB; stránka řidiče 3,5 ms proti 2,4 ms;
-- dispečink 201 ms proti 273 ms (dotaz se ptá identity jen tam, kde ukazatel
-- nic nenašel). Výsledek krok po kroku totožný (0 rozdílů ze 40 000).
--
-- Partial `superseded_by IS NULL`: dotaz chce jen platnou generaci a index
-- tak nenese historii.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_li_source_registry_fields_gin
  ON public.li_source_registry USING gin (fields jsonb_path_ops)
  WHERE superseded_by IS NULL;
