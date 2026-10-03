-- ============================================================================
-- Source of Truth: counterparty_labels
-- Popis: AKTUÁLNÍ JMÉNO protistrany pro MNOŽINU IČO — totéž pravidlo, jaké má karta
--        (counterparty_resolve.label), jen spočtené najednou pro celý přehled.
--
-- ⛔ JMÉNO NENÍ IDENTITA (majitel 2026-07-31, 2026-09-29): firma se přejmenuje,
--    fúzuje, a její staré jméno může převzít JINÁ firma. Naměřeno 2026-09-29 na riq
--    (vydané faktury): 14 IČO nese víc jmen (přejmenování), 6 jmen nese víc IČO —
--    „Slezské kamenolomy a.s." přešlo 1. 10. 2019 z IČO 29243661 (dnes Business Park
--    Ďáblická) na 08300283. Přehledy seskupené podle jména proto jednu firmu ROZDĚLILY
--    a dvě různé SLILY (142 268 = 117 975 + 24 293 Kč v jednom řádku).
--
-- Pořadí zdrojů jména (jako karta):
--   1. SCHVÁLENÝ název — `company_name`/`nase_firma` potvrzený člověkem a platný TEĎ
--      (valid_from/valid_to) u dvojčete nesoucího to IČO. Změna jména na dokladu je
--      návrh ingestu, pravdou je až po schválení.
--   2. do schválení: jméno z NEJNOVĚJŠÍHO dokladu s tím IČO (podle data vystavení) —
--      přejmenovaná firma se tak ukáže pod dnešním jménem, i když jí po splatnosti
--      visí faktura vystavená na jméno staré.
-- Jméno platné k datu dokladu (jména v čase, fúze) je samostatná vrstva — tady jen „teď".
--
-- Vstup: pole IČO (prázdné / NULL prvky se ignorují). Výstup: (ico, label, schvaleno).
-- SECURITY INVOKER: viditelnost dokladů i vazeb rozhoduje RLS volajícího.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.counterparty_labels(p_icos text[])
RETURNS TABLE (ico text, label text, schvaleno boolean)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  with vstup as (
    select distinct i as ico from unnest(coalesce(p_icos, '{}'::text[])) i
     where nullif(btrim(i), '') is not null
  ),
  -- 2. nejnovější jméno z dokladů (kterýkoli druh dokladu s tím IČO)
  z_dokladu as (
    select distinct on (r.counterparty_id_value)
           r.counterparty_id_value        as ico,
           btrim(r.counterparty_value)    as jmeno
      from public.li_source_registry r
     where r.superseded_by is null
       and r.counterparty_id_value in (select ico from vstup)
       and length(btrim(coalesce(r.counterparty_value, ''))) between 2 and 80
     order by r.counterparty_id_value,
              coalesce(r.fields->'issue_date'->>'value', r.created_at::date::text) desc,
              r.created_at desc
  ),
  -- 1. schválený název platný teď, u dvojčete s vazbou na to IČO
  schvalene as (
    select distinct on (ri.source_key)
           ri.source_key as ico, rn.source_key as jmeno
      from public.twin_external_refs ri
      join public.twin_external_refs rn on rn.twin_id = ri.twin_id
     where ri.ref_kind = 'company_ico' and ri.state <> 'rejected'
       and ri.source_key in (select ico from vstup)
       and rn.ref_kind in ('company_name', 'nase_firma') and rn.state = 'confirmed'
       and (rn.valid_from is null or rn.valid_from <= now())
       and (rn.valid_to is null or rn.valid_to > now())
     order by ri.source_key, rn.valid_from desc nulls last, rn.confirmed_at desc nulls last
  )
  select v.ico,
         coalesce(s.jmeno, d.jmeno)  as label,
         (s.jmeno is not null)       as schvaleno
    from vstup v
    left join schvalene s on s.ico = v.ico
    left join z_dokladu d on d.ico = v.ico;
$$;

COMMENT ON FUNCTION public.counterparty_labels(text[]) IS
  'Aktuální jméno protistrany pro množinu IČO: schválený název platný teď (company_name/nase_firma), jinak jméno z nejnovějšího dokladu s tím IČO. Totéž pravidlo jako counterparty_resolve.label, množinově pro přehledy.';

REVOKE ALL ON FUNCTION public.counterparty_labels(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.counterparty_labels(text[]) TO authenticated, service_role;
