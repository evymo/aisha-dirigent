-- Function: public.li_finding_is_current
-- Týká se nález AKTUÁLNÍ verze dokladů? (documents = li_findings.documents)
--
-- Registr při změně obsahu doklad překlíčuje na nový sha
-- (li_upsert_source_registry), ale nález staré verze v li_findings zůstává —
-- odtud tentýž soubor 2× v seznamu nálezů (produkce 2026-09-28). Nález je
-- starý, jen když to jde PROKÁZAT: jeho verze je nahrazená (superseded_by),
-- nebo registr doklad téhož jména zná, ale s jiným obsahem. Chybí-li doklad
-- v registru úplně, nález platí — mlčet o něm by bylo horší než ho ukázat.
--
-- Jediné místo toho predikátu: čtení dotazů (get_finding_questions) i zápis
-- odpovědi (submit_evidence_review_audited, větev 'finding') musí počítat
-- tytéž doklady, jinak by verdikt zapsal jiný počet, než člověk viděl.

create or replace function public.li_finding_is_current(p_documents jsonb)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select not exists (
    select 1
      from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) d
     where d->>'source_sha256' is not null
       and (
         exists (select 1 from public.li_source_registry r
                  where r.source_sha256 = d->>'source_sha256'
                    and r.superseded_by is not null)
         or (
           not exists (select 1 from public.li_source_registry r
                        where r.source_sha256 = d->>'source_sha256')
           and exists (select 1 from public.li_source_registry r
                        where r.filename = d->>'filename')
         )
       )
  );
$$;

revoke all on function public.li_finding_is_current(jsonb) from public, anon;
grant execute on function public.li_finding_is_current(jsonb) to authenticated, service_role;
