-- Index: uq_twin_external_refs_active_account_twin
-- Source of truth pair: aisha/db/sql/tables/twin_external_refs.sql
--
-- Invariant: JEDEN TWIN = nejvýš JEDEN aktivní účet. Druhá polovina páru
-- k `uq_twin_external_refs_active_account` (tam: jeden účet = jeden twin).
--
-- ⛔ NAMĚŘENO 2026-09-10, DÍRA V TOM, CO JSEM SÁM PŘIDAL. Vazba účtu se dá
-- vytvořit uplatněním pozvánky (`claim_invitation`) a ta cesta má dvě
-- vlastnosti, které spolu dávají průchod:
--   · `claim_invitation` NEKONTROLUJE adresáta — uplatní ji kdokoli s kódem,
--   · `create_invitation` vkládá `max_uses` = NULL (přebíjí default 1), a
--     podmínka `(max_uses IS NULL OR used_count < max_uses)` znamená NEOMEZENĚ.
-- Bez tohohle indexu by se tedy na JEDEN twin navázalo libovolně mnoho účtů
-- a všechny by přes `my_twins` viděly práci té jedné osoby.
--
-- ⭐ PROČ INDEX, A NE JEN OPRAVA TÉ CESTY. Cest, kterými vazba vzniká, je pět
-- (`claim_invitation`, `twin_identity_*_binding`, `twin_upsert_entity_audited`)
-- a přibývají. Podmínka „člověk je jeden" je vlastnost DAT, ne jedné funkce —
-- na úrovni tabulky platí i pro cestu, kterou dnes nikdo nenapsal.
--
-- ⛔ SMĚR SELHÁNÍ JE TU ROZHODUJÍCÍ. Chybějící přístup uživatel nahlásí do
-- minuty; PŘEBÝVAJÍCÍ nenahlásí nikdo, protože „vidím víc" nevypadá jako vada.
-- Proto se to zavírá zápisem (vadný zápis NEPROJDE), ne filtrem při čtení
-- (kde by se navíc tiše ztratila stará data).
--
-- Předání identity (člověk odejde, twin dostane jiný účet) se dělá `valid_to`,
-- ne mazáním — proto `valid_to IS NULL`.

CREATE UNIQUE INDEX IF NOT EXISTS uq_twin_external_refs_active_account_twin
  ON public.twin_external_refs (twin_id)
  WHERE ref_kind = 'account' AND state = 'confirmed' AND valid_to IS NULL;
