-- ============================================================================
-- Source of Truth: counterparty_periods
-- Popis: VZTAH PROTISTRANY V ČASE z dokladů — role × období. Jedna pravda pro
--        hlavičku karty (get_counterparty_card) i Ask (answer_verified_facts).
--          customer  odběratel: NAŠE vydané faktury (document_subtype = issued)
--          supplier  dodavatel: přijaté faktury (received)
--        prvni/posledni = datum VYSTAVENÍ do dneška včetně. Faktura vystavená
--        dopředu (předpis) vztah neprodlužuje — nese ji `predepsano`.
--        bez_stavu = doklady role, k nimž zdroj NEDODAL stav úhrady
--        (invoice_state = unknown), s vlastním obdobím.
--
-- ⭐ PROČ (majitel 2026-09-28, příklad protistrany z let 2021–22): uživatel se
--    ptá na AKTUÁLNÍ stav; historie doplňuje, nesmí převážit. Firma mohla být
--    odběratelem před čtyřmi lety a dnes nic — karta ani Ask to neuměly říct
--    a odpovídaly „dluh 0 Kč" / „bez dluhu" nad fakturami, u nichž zdroj stav
--    úhrady vůbec nedodal.
-- ⭐ STAV ÚHRADY JE SNÍMEK ZDROJE s časem, kdy ho zdroj dodal. Kde snímek chybí,
--    čtečka ho nesmí nahradit nulou (naměřeno 2026-09-28: 929 protistran,
--    jejichž žádná vydaná faktura stav úhrady nenese, karta hlásila „bez dluhu").
--
-- Doklady jsou TYTÉŽ jako v kartě (counterparty_docs: podle IČO, jménem jen
-- protistrana bez IČO). Storno pozná jen z kódů instance (p_storno, viz
-- storno_values_param); stav úhrady na datu pohledávky nezávisí, proto
-- invoice_state dostává pevně issue_date.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.counterparty_periods(
  p_icos text[],
  p_names text[],
  p_storno text[] DEFAULT '{}'::text[]
)
RETURNS TABLE (
  vztah text,
  prvni date,
  posledni date,
  dokladu bigint,
  predepsano bigint,
  bez_stavu bigint,
  bez_stavu_prvni date,
  bez_stavu_posledni date
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  with d as (
    select case r.fields->'document_subtype'->>'value'
             when 'issued' then 'customer'
             when 'received' then 'supplier' end as druh,
           -- CASE drží pořadí: přetypování až po regexu
           case when r.fields->'issue_date'->>'value' ~ '^\d{4}-\d{2}-\d{2}$'
                then (r.fields->'issue_date'->>'value')::date end as vystaveno,
           public.invoice_state(r.fields, 'issue_date', coalesce(p_storno, '{}'::text[])) as stav
      from public.counterparty_docs(p_icos, p_names, 'invoice') r
  )
  select druh,
         min(vystaveno) filter (where vystaveno <= current_date),
         max(vystaveno) filter (where vystaveno <= current_date),
         count(*) filter (where vystaveno <= current_date),
         count(*) filter (where vystaveno > current_date),
         count(*) filter (where stav = 'unknown'),
         min(vystaveno) filter (where stav = 'unknown'),
         max(vystaveno) filter (where stav = 'unknown')
    from d
   where druh is not null
   group by druh
   order by druh;
$$;

REVOKE ALL ON FUNCTION public.counterparty_periods(text[], text[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.counterparty_periods(text[], text[], text[]) TO authenticated, service_role;
