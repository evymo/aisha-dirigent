-- ============================================================================
-- Source of Truth: invoice_state
-- Popis: STAV POHLEDÁVKY jednoho dokladu — jeden slovník pro všechny čtečky
--        (karta protistrany, stáří dluhu, faktury odběratele, dlužníci, Ask).
--        Vrací klíč stavu; i18n klíč buňky je 'app.inv.state.' || stav.
--
--          storno      doklad stornovaný ve zdroji — není dluh, není vyfakturováno,
--                      nemá stáří. KTERÉ hodnoty pole `storno` znamenají storno,
--                      je KÓDOVÁNÍ ZDROJE, ne vlastnost platformy: deklaruje ho
--                      instance (`storno_values` v source_params, viz
--                      storno_values_param). Bez deklarace se storno nerozpozná.
--                      (RIQ/Money, naměřeno 2026-09-26: 1 = stornovaný doklad,
--                      2 = stornovací doklad s touž kladnou částkou — oba se dosud
--                      sčítaly do „vyfakturováno".)
--          unknown     doklad bez stavu úhrady (`amount_unpaid` chybí) — mlčet,
--                      ne hádat (starší korpus bez Money)
--          paid        zbývá 0
--          scheduled   PŘEDEPSÁNO: datum vzniku pohledávky je v budoucnu
--                      (faktura vystavená dopředu) — předpis, ne dluh
--          correction  opravný doklad (záporné `amount_unpaid`) — odečítá
--                      (rozhodnutí majitele 2026-08-05, get_receivables_overdue)
--          overdue     zbývá > 0 a splatnost minula
--          open        zbývá > 0, ve splatnosti (nebo splatnost neznáme)
--
-- ⭐ PROČ JEDNO MÍSTO: naměřeno 2026-09-25 na kartě Inspirace — pět čteček,
--    pět definic: karta dobropis nepočítala, tabulka dlužníků ano; storno
--    nepočítal nikdo; faktury vystavené dopředu (85 ks / 6,2 mil. Kč) se
--    sčítaly jako dluh a karta hlásila 588 383 Kč místo 259 597 Kč.
--
-- ⭐ OD KDY JE DOKLAD POHLEDÁVKOU = parametr instance `receivable_from`
--    (source_params bloku: issue_date | taxable_supply_date | due_date).
--    Rozhodnutí majitele 2026-09-25: datum VYSTAVENÍ — proto je to výchozí.
--    Neznámá hodnota je chyba konfigurace, ne tichý jiný výklad (viz
--    receivable_from_param).
--
-- Pořadí větví je význam: storno přebije vše; uhrazený doklad vystavený
-- dopředu je „uhrazeno", ne „předepsáno" (nic nedluží); datum v budoucnu
-- přebije splatnost (předpis nemůže být po splatnosti).
--
-- STABLE (current_date), jeden výraz bez SET → planner ji VLOŽÍ do volající
-- čtečky (vzor norm_text); tabulka dlužníků ji volá nad celým registrem faktur.
-- Nestaví na žádné tabulce, jen na operátorech pg_catalog — search_path
-- nepotřebuje. CASE drží pořadí vyhodnocení: přetypování až po regexu.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.invoice_state(
  p_fields jsonb,
  p_receivable_from text DEFAULT 'issue_date',
  p_storno_values text[] DEFAULT '{}'::text[]
)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  select case
    when p_fields->'storno'->>'value' = any(p_storno_values)
      then 'storno'
    when coalesce(p_fields->'amount_unpaid'->>'value', '') !~ '^-?[0-9]+(\.[0-9]+)?$'
      then 'unknown'
    when abs((p_fields->'amount_unpaid'->>'value')::numeric) <= 0.005
      then 'paid'
    when case when p_fields->p_receivable_from->>'value' ~ '^\d{4}-\d{2}-\d{2}$'
              then (p_fields->p_receivable_from->>'value')::date end > current_date
      then 'scheduled'
    when (p_fields->'amount_unpaid'->>'value')::numeric < 0
      then 'correction'
    when case when p_fields->'due_date'->>'value' ~ '^\d{4}-\d{2}-\d{2}$'
              then (p_fields->'due_date'->>'value')::date end < current_date
      then 'overdue'
    else 'open'
  end;
$$;

REVOKE ALL ON FUNCTION public.invoice_state(jsonb, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_state(jsonb, text, text[]) TO authenticated, service_role;
