-- ============================================================================
-- Source of Truth: fn_identita_vektoru
-- Popis: Identita vah ULOŽENÉHO vektoru z jeho model_version — JEDINÝ domov rozboru.
--        model_version vektoru = `<formát>:<sha256>;recipe=<recept>` (dopočet v1, ingest
--        z lane); identita je část před středníkem. Vektor bez identity (proveniencní značka
--        `<provider>:space_resolver:<prostor>`, starý runtime) vrací svou první část, která
--        žádné deklarované identitě (`<formát>:<64 hex>`) neodpovídá — takový vektor se
--        s dotazem nikdy nesrovná a dopočet ho přepočítá.
--        Čtou ji fn_chunks_bez_zive_identity (co přepočítat) i mcp_search_knowledge_v3 (s čím
--        srovnat dotaz): obě strany tak „živý vektor“ rozumí stejně.
--
-- Čistá funkce bez přístupu k datům (IMMUTABLE, LANGUAGE sql → plánovač ji vloží do dotazu).
-- ZÁMĚRNĚ bez `SET search_path`: klauzule SET vložení do dotazu zakáže (funkce by se volala
-- pro každý vektor korpusu). Tělo volá jen vestavěné funkce pg_catalog, který se prohledává
-- vždy první — přesměrovat je search_path volajícího nemůže. Běží s právy volajícího (ne definer).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_identita_vektoru(p_model_version text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT nullif(split_part(coalesce(p_model_version, ''), ';', 1), '')
$$;

REVOKE ALL ON FUNCTION public.fn_identita_vektoru(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_identita_vektoru(text) TO authenticated, service_role;
