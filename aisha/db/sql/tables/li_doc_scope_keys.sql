-- =============================================================================
-- li_doc_scope_keys — PŘEDPOČÍTANÉ klíče dokladů pro nárok z vazeb.
--
-- ⛔ PROČ TABULKA, NE DOTAZ NAD fields (naměřeno 2026-09-28 na produkci, jen čtení):
--   párování nemovitostní agendy (4 vlastníci faktur + pronajímatel smluv,
--   4 589 dokladů) přímo nad `li_source_registry.fields`:
--     lower(btrim(fields->k->>'value')) = hodnota   ·  905 ms
--     fields @> vzor (GIN jsonb_path_ops), spojení  · 1 353 ms (index nepoužit)
--     fields @> konstanty přes OR (BitmapOr)       ·   201 ms, z toho 163 ms
--                                                     rozbalení velkých fields
--   Nárok je člen politiky — počítá se při KAŽDÉM dotazu uživatele na doklady;
--   sekce o deseti blocích by nesla sekundy navíc. Tady je hodnota vytažená
--   jednou (trigger na registru) a nárok je indexový dotaz bez rozbalování JSON.
--
-- Obsah: pro každou PLATNOU verzi dokladu (superseded_by IS NULL):
--   • hodnoty polí z aktivních pravidel twin_scope_doc_rules + protistrana
--     (counterparty_id, counterparty) — typy, které pravidla znají;
--   • PŮVOD (všechny doklady): `@instance` = instance zdroje ze záznamu konektoru
--     (např. agenda Money), `@cesta` = každý nadřazený adresář relativní cesty ve
--     vstupu ingestu (raw_data.source_path) — pro udělení zdroje dat uživateli.
--   `hodnota` = lower(btrim(value)) — value z `{value,…}`, u staršího korpusu skalár.
-- Udržuje: trigger na li_source_registry (řádek) a přestavba při změně pravidel.
-- Přístup jen přes funkce; RLS bez politik, žádné granty pro anon/authenticated.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.li_doc_scope_keys (
  source_sha256  text NOT NULL
                 REFERENCES public.li_source_registry (source_sha256) ON DELETE CASCADE ON UPDATE CASCADE,
  doc_slug       text NOT NULL,
  doc_type       text NOT NULL,
  field_key      text NOT NULL,
  hodnota        text NOT NULL CHECK (hodnota <> ''),
  zobrazeni      text,
  CONSTRAINT li_doc_scope_keys_pkey PRIMARY KEY (source_sha256, field_key, hodnota)
);

-- ⭐ PŮVOD DOKLADU (2026-09-28): klíče `@instance` (instance zdroje od konektoru) a `@cesta`
-- (každý nadřazený adresář relativní cesty ve vstupu ingestu) nesou i původní zápis —
-- správa v Lidé a účty vybírá zdroje podle jména, ne podle normalizované hodnoty.
ALTER TABLE public.li_doc_scope_keys ADD COLUMN IF NOT EXISTS zobrazeni text;

COMMENT ON TABLE public.li_doc_scope_keys IS
  'Předpočítané hodnoty polí dokladů pro nárok z vazeb (pole z twin_scope_doc_rules + protistrana); jen platné verze. Udržuje trigger na li_source_registry a přestavba při změně pravidel.';

ALTER TABLE public.li_doc_scope_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.li_doc_scope_keys FROM PUBLIC, anon, authenticated;
