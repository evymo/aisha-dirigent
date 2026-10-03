-- ============================================================================
-- Source of Truth: counterparty_contracts
-- Popis: SMLOUVY PROTISTRANY — jedna odpověď pro kartu (počet) i síť vazeb
--        (uzly). Dvě cesty, každá se svou jistotou:
--          derived    smlouva nese IČO/jméno protistrany v polích (counterparty_docs)
--          proposed   ingest ji navrhl k twinu firmy (identified_tenant, čeká na člověka)
--          confirmed  člověk návrh potvrdil
--        Jedna smlouva jednou; vyhrává nejvyšší jistota.
--
-- ⭐ PROČ JEDNO MÍSTO: naměřeno 2026-09-25 na kartě Inspirace — síť vazeb
--    smlouvu ukázala (návrh k twinu), hlavička karty napsala „Smluv: 0", protože
--    počítala jen smlouvy s IČO v polích. Pole smluv strany dnes nenesou
--    (li_links / contract_register 0), takže bez návrhů by karta smlouvy neviděla
--    vůbec. Dvě čtečky, dvě pravdy — teď jedna.
--
-- Vstup je výstup counterparty_resolve (icos, names, twins) — karta i síť
-- rozřeší protistranu jednou a sem pošlou totéž.
-- SECURITY INVOKER: viditelnost rozhoduje RLS nad li_source_registry a twin_*.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.counterparty_contracts(p_icos text[], p_names text[], p_twins jsonb)
RETURNS TABLE (doc_slug text, filename text, fields jsonb, certainty text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  with tw as (
    select (x->>'id')::uuid as id from jsonb_array_elements(coalesce(p_twins, '[]'::jsonb)) x
  ),
  smlouvy as (
    select d.doc_slug, d.filename, d.fields, 'derived' as certainty
      from public.counterparty_docs(p_icos, p_names, 'contract') d
    union all
    select l.doc_slug, l.filename, l.fields,
           case r.state when 'confirmed' then 'confirmed' else 'proposed' end
      from tw
      join public.twin_external_refs r on r.twin_id = tw.id and r.ref_kind = 'identified_tenant' and r.state <> 'rejected'
      join public.li_source_registry l on l.source_sha256 = r.source_key and l.superseded_by is null
  )
  select distinct on (s.doc_slug) s.doc_slug, s.filename, s.fields, s.certainty
    from smlouvy s
   order by s.doc_slug, case s.certainty when 'confirmed' then 0 when 'proposed' then 1 else 2 end;
$$;

REVOKE ALL ON FUNCTION public.counterparty_contracts(text[], text[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.counterparty_contracts(text[], text[], jsonb) TO authenticated, service_role;
