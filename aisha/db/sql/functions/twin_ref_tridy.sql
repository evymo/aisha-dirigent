-- ============================================================================
-- Source of Truth: twin_ref_tridy
-- Popis: TŘÍDA SHODY návrhů identit (twin_external_refs, stav proposed) —
--        JEDINÝ vlastník pravidla „smí se tenhle návrh schválit v dávce?".
--        Blok skupin (get_twin_ref_group_block) z něj skládá nabídku, dávka
--        (twin_ref_group_decide) ho volá ZNOVU v okamžiku provedení; co mezitím
--        přestalo platit, do dávky nepadne.
--
-- ⛔ PRAVIDLO MAJITELE (2026-09-28): „teprve dva zdroje pravdy se shodou sto
-- procent opravňují k návrhu na hromadné sloučení"; „pokud jméno nemá IČO, může
-- to být soukromá osoba"; „co se týká IČO, je to v závislosti na časovém údaji";
-- „pokud je IČO a název a odpovídá to datum z veřejného rejstříku, můžeme to brát
-- jako potvrzení existence". Důkazy se odvozují ŽIVĚ z dokladů, které ingest drží
-- teď — ne z poznámky exportu, ze kterého návrh kdysi vznikl.
--
-- ZDROJ PRAVDY = třída dokladu, kterou přiděluje ingest (li_source_registry
-- .doc_class, např. záznamy účetnictví × smluvní dokumenty) + výpis z veřejného
-- rejstříku (doc_type z konfigurace). Dva exporty téhož účetnictví jsou JEDEN
-- zdroj — naměřeno 2026-09-28: 844 z 879 návrhů IČO stálo jen na účetnictví.
--
-- JMÉNO V ČASE: firma se přejmenuje a staré jméno může převzít jiná firma, takže
-- se jméno z dokladu porovnává se jménem PLATNÝM K DATU dokladu, ne s dnešním.
--   · s výpisem z rejstříku: každý datovaný doklad musí nést jméno, které rejstřík
--     k jeho datu vede; jinak rozpor. Shoda = aspoň jeden takový doklad + dnešní
--     jméno z rejstříku sedí na dvojče.
--   · bez výpisu: rozpor = dvě různá jména téhož IČO v překrývajícím se období;
--     shoda = totéž (poslední) jméno ve dvou třídách dokladů a v celém rozpětí,
--     kdy ho uvádějí, žádné jiné jméno; poslední jméno sedí na dvojče.
--
-- TŘÍDY: shoda_dva_zdroje | jeden_zdroj | rozpor | jmeno_nesedi_na_twin |
--        smisene_dvojce (dvojče nese i jméno, které IČO nikdy nemělo) |
--        bez_data | bez_dokladu | nepodporovano (jiný druh klíče než IČO —
--        samotné jméno může patřit soukromé osobě, hromadně nikdy).
--
-- Konfigurace (p_params = source_params bloku skupin):
--   source       POVINNÉ  twin_external_refs.source
--   entity_type  volitelné twin_entities.entity_type
--   date_fields  POVINNÉ  {doc_type: [pole data, …]} — první vyplněné je datum
--                         dokladu (schémata časovou osu nedeklarují)
--   register     volitelné {doc_type, ico_field, name_field, from_field, to_field}
--                         — výpis z rejstříku: IČO v hlavičce, období jmen v položkách
-- p_ref_ids: omezení na konkrétní návrhy (NULL = všechny navržené ze zdroje).
--
-- SECURITY INVOKER: volající vidí jen doklady, na které má nárok. Blok i dávka
-- jsou pro správu, která vidí vše — třída tak nezávisí na tom, kdo se ptá.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.twin_ref_tridy(p_params jsonb, p_ref_ids uuid[] DEFAULT NULL)
RETURNS TABLE (ref_id uuid, ref_kind text, twin_id uuid, trida text, group_key text,
               zdroje text[], jmeno_ted text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  with cfg as (
    select p_params->>'source'                       as src,
           nullif(p_params->>'entity_type', '')      as etype,
           coalesce(p_params->'date_fields', '{}')   as df,
           p_params->'register'                      as reg
  ),
  n as (
    select r.id, r.ref_kind, r.twin_id, r.source_key, t.label,
           case when r.ref_kind = 'company_ico' and btrim(r.source_key) ~ '^\d{1,8}$'
                then lpad(btrim(r.source_key), 8, '0') end as ico
    from public.twin_external_refs r
    join public.twin_entities t on t.id = r.twin_id
    cross join cfg
    where r.source = cfg.src
      and r.state = 'proposed'
      and (cfg.etype is null or t.entity_type = cfg.etype)
      and (p_ref_ids is null or r.id = any (p_ref_ids))
  ),
  ica as (select distinct ico from n where ico is not null),
  -- Klíč původu nese IČO tak, jak ho zapsal doklad; s úvodními nulami i bez nich.
  hk as (select ico, ico as h from ica union select ico, ltrim(ico, '0') from ica),
  -- Doklady, které IČO nesou (klíče původu), s třídou, jménem a datem dokladu.
  dk as (
    select distinct on (hk.ico, d.source_sha256)
           hk.ico, d.source_sha256, d.doc_class as zdroj,
           public.nazev_firmy_klic(case
             when k.field_key = 'supplier_id' then d.fields->'supplier_name'->>'value'
             when k.field_key = 'counterparty_id' then d.fields->'counterparty'->>'value'
             when lpad(btrim(coalesce(d.fields->'supplier_id'->>'value', '')), 8, '0') = hk.ico
               then d.fields->'supplier_name'->>'value'
             when lpad(btrim(coalesce(d.fields->'counterparty_id'->>'value', '')), 8, '0') = hk.ico
               then d.fields->'counterparty'->>'value' end) as jmeno,
           (select left(d.fields->f->>'value', 10)::date
              from jsonb_array_elements_text(coalesce((select df from cfg)->d.doc_type, '[]')) f
             where d.fields->f->>'value' ~ '^\d{4}-\d{2}-\d{2}'
             limit 1) as dt
    from hk
    join public.li_doc_scope_keys k
      on k.hodnota = hk.h and k.field_key in ('counterparty_id', 'supplier_id', '@firma')
    join public.li_source_registry d
      on d.source_sha256 = k.source_sha256 and d.superseded_by is null
    where d.doc_type is distinct from ((select reg from cfg)->>'doc_type')
    order by hk.ico, d.source_sha256, k.field_key
  ),
  dd as (select ico, source_sha256, zdroj, jmeno, dt from dk where dt is not null and jmeno is not null),
  -- Období jmen z výpisu rejstříku [od, do); do NULL = platí dosud.
  rg as (
    select x.ico, x.jmeno, x.od, x.do_
    from cfg c
    join public.li_source_registry d
      on c.reg is not null and d.doc_type = c.reg->>'doc_type' and d.superseded_by is null
    cross join lateral jsonb_array_elements(coalesce(d.line_items, '[]')) li
    cross join lateral (select
        lpad(regexp_replace(coalesce(d.fields->(c.reg->>'ico_field')->>'value', ''), '\D', '', 'g'), 8, '0') as ico,
        public.nazev_firmy_klic(li->'fields'->(c.reg->>'name_field')->>'value') as jmeno,
        case when li->'fields'->(c.reg->>'from_field')->>'value' ~ '^\d{4}-\d{2}-\d{2}'
             then left(li->'fields'->(c.reg->>'from_field')->>'value', 10)::date end as od,
        case when li->'fields'->(c.reg->>'to_field')->>'value' ~ '^\d{4}-\d{2}-\d{2}'
             then left(li->'fields'->(c.reg->>'to_field')->>'value', 10)::date end as do_) x
    where x.od is not null and x.jmeno is not null
      and x.ico in (select ico from ica)
  ),
  -- Každý datovaný doklad vs. jméno, které rejstřík vede k jeho datu.
  vs_rg as (
    select dd.ico, dd.source_sha256, dd.zdroj,
           bool_or(rg.jmeno = dd.jmeno and rg.od <= dd.dt and (rg.do_ is null or dd.dt < rg.do_)) as sedi
    from dd join rg on rg.ico = dd.ico
    group by dd.ico, dd.source_sha256, dd.zdroj
  ),
  a_rg as (
    select ico, bool_or(not sedi) as rozpor, bool_or(sedi) as shoda,
           array_agg(distinct zdroj) filter (where sedi) as zdroje
    from vs_rg group by ico
  ),
  ted_rg as (
    select distinct on (ico) ico, jmeno from rg where do_ is null order by ico, od desc, jmeno
  ),
  -- Bez rejstříku: období jména v každé třídě dokladů.
  iv as (select ico, zdroj, jmeno, min(dt) as od, max(dt) as do_ from dd group by 1, 2, 3),
  rozpor_dk as (
    select distinct a.ico from iv a join iv b
      on a.ico = b.ico and a.jmeno <> b.jmeno and a.od <= b.do_ and b.od <= a.do_
  ),
  -- Shoda bez rejstříku: totéž jméno ve dvou třídách dokladů a v celém rozpětí, kdy ho
  -- zdroje uvádějí, žádné jiné jméno (přejmenování mezi nimi = shoda neplatí).
  n_rozpeti as (
    select ico, jmeno, min(od) as od, max(do_) as do_, count(distinct zdroj) as zdroju
    from iv where zdroj is not null group by ico, jmeno
  ),
  shoda_dk as (
    select u.ico, u.jmeno from n_rozpeti u
    where u.zdroju >= 2
      and not exists (select 1 from iv o where o.ico = u.ico and o.jmeno <> u.jmeno
                        and o.od <= u.do_ and u.od <= o.do_)
  ),
  ted_dd as (select distinct on (ico) ico, jmeno from dd order by ico, dt desc, jmeno),
  zdroje_dk as (select ico, jmeno, array_agg(distinct zdroj) as zdroje from iv group by ico, jmeno),
  s_dokladem as (select distinct ico from dk),
  s_datem as (select distinct ico from dd),
  s_rejstrikem as (select distinct ico from rg),
  -- Jména, která IČO v čase neslo (doklady i rejstřík).
  jmena_ico as (select ico, jmeno from dd union select ico, jmeno from rg),
  -- Jména FIRMY dvojčete: návrhy a potvrzení company_name (název dvojčete bývá adresa,
  -- PSČ nebo číslo účtu — naměřeno 2026-09-28 — takže sám o sobě jménem není).
  tj as (
    select x.twin_id, public.nazev_firmy_klic(x.source_key) as jmeno
    from public.twin_external_refs x
    where x.ref_kind = 'company_name' and x.state in ('proposed', 'confirmed')
      and x.twin_id in (select twin_id from n)
  ),
  -- Smíšené dvojče: nese i jméno, které IČO nikdy nemělo (jiná firma v témže dvojčeti).
  smisene as (
    select distinct n.id from n
    join tj on tj.twin_id = n.twin_id and tj.jmeno is not null
    where n.ico is not null
      and not exists (select 1 from jmena_ico ji where ji.ico = n.ico and ji.jmeno = tj.jmeno)
  ),
  souhrn as (
    select i.ico,
           sd.ico is not null as ma_doklad,
           st.ico is not null as ma_datum,
           sr.ico is not null as ma_rejstrik,
           coalesce(ar.rozpor, false) as rozpor_rg,
           coalesce(ar.shoda, false) as shoda_rg,
           ar.zdroje as zdroje_rg,
           rd.ico is not null as rozpor_dk,
           coalesce(tr.jmeno, td.jmeno) as jmeno_ted
    from ica i
    left join a_rg ar on ar.ico = i.ico
    left join rozpor_dk rd on rd.ico = i.ico
    left join ted_rg tr on tr.ico = i.ico
    left join ted_dd td on td.ico = i.ico
    left join s_dokladem sd on sd.ico = i.ico
    left join s_datem st on st.ico = i.ico
    left join s_rejstrikem sr on sr.ico = i.ico
  ),
  k as (
    select n.id, n.ref_kind, n.twin_id, s.jmeno_ted,
      case
        when n.ico is null then 'nepodporovano'
        when not s.ma_doklad and not s.ma_rejstrik then 'bez_dokladu'
        when s.ma_rejstrik and s.rozpor_rg then 'rozpor'
        when s.ma_rejstrik and not s.shoda_rg then 'jeden_zdroj'
        when not s.ma_rejstrik and not s.ma_datum then 'bez_data'
        when not s.ma_rejstrik and s.rozpor_dk then 'rozpor'
        when s.jmeno_ted is null
          or not (s.jmeno_ted = public.nazev_firmy_klic(n.label)
                  or exists (select 1 from tj where tj.twin_id = n.twin_id and tj.jmeno = s.jmeno_ted))
          then 'jmeno_nesedi_na_twin'
        when sm.id is not null then 'smisene_dvojce'
        when s.ma_rejstrik then 'shoda_dva_zdroje'
        when sk.ico is not null then 'shoda_dva_zdroje'
        else 'jeden_zdroj'
      end as trida,
      case when s.ma_rejstrik then coalesce(s.zdroje_rg, '{}') || array['rejstrik']
           else zd.zdroje end as zdroje
    from n
    left join souhrn s on s.ico = n.ico
    left join shoda_dk sk on sk.ico = n.ico and sk.jmeno = s.jmeno_ted
    left join zdroje_dk zd on zd.ico = n.ico and zd.jmeno = s.jmeno_ted
    left join smisene sm on sm.id = n.id
  )
  select k.id, k.ref_kind, k.twin_id, k.trida,
         'twin_identity:' || k.ref_kind || ':' || k.trida, k.zdroje, k.jmeno_ted
  from k;
$$;

COMMENT ON FUNCTION public.twin_ref_tridy(jsonb, uuid[]) IS
  'Třída shody navržených identit (dva nezávislé zdroje pravdy v čase: třídy dokladů + výpis z rejstříku). Jediný vlastník pravidla pro blok skupin i dávku.';

REVOKE ALL ON FUNCTION public.twin_ref_tridy(jsonb, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.twin_ref_tridy(jsonb, uuid[]) TO authenticated, service_role;
