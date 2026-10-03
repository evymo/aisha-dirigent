-- Index: idx_li_source_registry_counterparty_id_value
-- Table: li_source_registry
--
-- PROČ: karta protistrany (counterparty_resolve, counterparty_docs → bloky karty),
-- detail dlužníka (get_debtor_invoices) a přehledy (counterparty_labels) hledají
-- doklady podle `fields.counterparty_id`. Nahrazuje expresní idx_li_source_registry_counterparty_id
-- (2026-09-23): pod RLS ho planner NEPOUŽIL nikdy — výraz nad jsonb není leakproof,
-- takže jde až za politiku (naměřeno riq 2026-09-29: resolve 2 706 ms jako admin,
-- 23 ms jako service_role). Nad prostým generovaným sloupcem je podmínka leakproof
-- (texteq) → Index Scan i pro přihlášeného. Částečný: jen platné verze.

CREATE INDEX IF NOT EXISTS idx_li_source_registry_counterparty_id_value
  ON public.li_source_registry (counterparty_id_value)
  WHERE superseded_by IS NULL;
