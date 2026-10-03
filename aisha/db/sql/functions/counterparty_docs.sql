-- ============================================================================
-- Source of Truth: counterparty_docs
-- Popis: platné doklady (superseded_by is null) daného typu jedné protistrany.
--        Podle IČO (`fields.counterparty_id` = any icos); podle JMÉNA jen u protistrany
--        BEZ IČO a jen doklady bez IČO — totéž jméno nese víc firem (firma se
--        přejmenovává, jméno je parametr v čase).
--        Oba predikáty jdou po svém indexu (idx_li_source_registry_counterparty_id_value /
--        _counterparty_value); `OR` dvou indexovaných podmínek zvládne BitmapOr.
--        ⛔ Filtr nad GENEROVANÝM sloupcem, ne nad `fields` (2026-09-29): pod RLS smí
--        planner do indexu jen leakproof podmínku a výraz nad jsonb jí není — expresní
--        index se pro přihlášeného nepoužil nikdy (viz tables/li_source_registry.sql).
-- SECURITY INVOKER: viditelnost rozhoduje RLS nad li_source_registry.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.counterparty_docs(p_icos text[], p_names text[], p_doc_type text)
RETURNS SETOF li_source_registry
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  select r.*
    from public.li_source_registry r
   where r.superseded_by is null
     and r.doc_type = p_doc_type
     and (r.counterparty_id_value = any(p_icos)
          -- Podle JMÉNA jen protistrana, která IČO NEMÁ (fyzická osoba). Naměřeno
          -- 23. 9.: u IČO dlužníků by jméno přitáhlo doklady bez IČO — 909 v evidenci,
          -- u jednoho dlužníka 60 dokladů / 30 mil. Kč, typicky PDF kopie téže faktury
          -- z Money (bez owner_company, bez amount_unpaid). Čísla karty je filtr
          -- `issued` sice odfiltroval, ale jména v čase a adresu by zkreslily.
          or (cardinality(p_icos) = 0
              and r.counterparty_value = any(p_names)
              and r.counterparty_id_value is null));
$$;

REVOKE ALL ON FUNCTION public.counterparty_docs(text[], text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.counterparty_docs(text[], text[], text) TO authenticated, service_role;
