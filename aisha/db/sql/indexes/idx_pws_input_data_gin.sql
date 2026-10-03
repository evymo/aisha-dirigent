-- Index: idx_pws_input_data_gin
--
-- ⚠️ Ta hlavička výš NENÍ ozdoba: generátor baseline bere ze `sql/indexes/` jen
-- soubory s markerem `-- Index:` a ostatní TIŠE PŘESKOČÍ. Bez ní je index v repu,
-- v heals se přehraje, ale na čistě postavené DB nevznikne — a to se pozná až
-- podle pomalého dotazu, ne podle chyby.
--
-- GIN nad konfigurací uzlu — pro dotazy tvaru `input_data @> {...}`.
--
-- Dva čtenáři, oba containment a oba generické (žádné jméno pole tady nestojí):
--   · `input_match` ve frontě (`get_workflow_my_steps_block`) — čím se pozná
--     „ještě nevyřízené", je vlastnost domény, tedy DATA;
--   · `resolve_entity_reference` — přesný klíč → entita, kde se hledaný kód
--     bere z katalogu parametrů, takže se hledá pro KAŽDÝ identitní kód zvlášť.
--     Bez indexu je to průchod všemi kroky krát počet kódů.
--
-- `jsonb_path_ops` ZÁMĚRNĚ: proti výchozímu `jsonb_ops` je výrazně menší a
-- rychlejší, a umí přesně to jediné, co oba čtenáři potřebují — operátor `@>`.
-- Existenci klíče (`?`) nikdo z nich nehledá.
CREATE INDEX IF NOT EXISTS idx_pws_input_data_gin
  ON public.production_workflow_steps
  USING gin (input_data jsonb_path_ops);
