-- ============================================================================
-- Source of Truth: get_doc_expiry_review_block
-- Popis: GENERICKÝ blok `table` — platnosti dokladů z JEJICH VLASTNÍCH POLÍ:
--        doklady daného typu, které nesou datum v poli `date_field`, seřazené
--        od toho nejbližšího dnešku („končí nejdřív", resp. „skončilo nedávno").
--        Řádek otevírá detail dokladu (`row_kind: document`, `id` = doc_slug,
--        týž klíč jako registr dokladů).
--
-- ⛔ PROČ NAD POLI DOKLADU, A NE NAD VAZBAMI NA TWINY (naměřeno 2026-09-23 na
--   produkci, analýza smluv v2 §C a §5):
--   Do 2026-09-24 funkce četla `twin_external_refs` (source `li-contracts`) a
--   spojovala je přes `li.id::text = source_key`. Takové vazby v provozu NEJSOU
--   (0) a žádný zapisovatel je nevyrábí — bloky sm_expiry a pd_recommend proto
--   nemohly ukázat NIC a musely být schovány (idata #100). Vazby smlouva↔firma
--   sice existují (185 návrhů „nájemce smlouvy"), ale jsou jen NAVRŽENÉ a
--   většinou chybné (TZÚS jako nájemce bytů); přepojit blok na ně by ukázalo
--   špatné nájemce jako fakt. Datum platnosti přitom smlouva nese sama
--   (`fields.valid_to`, 141 z 813). Protistrana se proto ukazuje TAK, JAK JI
--   UVÁDÍ DOKLAD — stejně jako v registru dokladů (get_document_register),
--   aby celé prostředí mluvilo o protistraně jedním způsobem.
--
--   Zároveň vypadla heuristika „následný doklad" (filename ILIKE '%<první slovo
--   labelu twinu>%'): stála na labelu twinu, který tu už není, a na slově
--   z názvu souboru se nedá poctivě rozhodnout, že smlouva má dodatek.
--
-- ⭐ ČERSTVOST Z DAT (vzor get_twin_metric_kpi_block, #1052): `freshness_at` =
--   nejnovější `created_at` v univerzu bloku (NE `ingested_at` — ten přepisuje každý import,
--   naměřeno 2026-09-27: 813 smluv = jediný čas; pořadí: čas ze zdroje › příchod verze), spočtený VE STEJNÉM DOTAZU jako
--   řádky. Prázdné univerzum → `now()` JEN jako záloha a `trace_id` končí
--   `:no_data`, aby se prázdno nedalo číst jako čerstvé „nic nekončí".
--
-- Konfigurace (p_params):
--   doc_type        POVINNÉ   li_source_registry.doc_type (např. contract)
--   date_field      POVINNÉ   klíč v li_source_registry.fields (např. valid_to)
--   direction       volitelné 'upcoming' (výchozí: datum ≥ dnes, nejbližší první)
--                             | 'expired' (datum < dnes, naposledy skončené první,
--                             se sloupcem počtu dní po skončení)
--   owner_company   volitelné pohled podle firmy — TÝŽ parametr, jaký posílá
--                             přepínač nad sekcí registru dokladů
--   date_label_key  volitelné klíč překladu hlavičky data (výchozí app.cols.valid_to)
--   limit           volitelné počet řádků (výchozí 100, strop 500)
--   Dřívější klíče (source, entity_type, absent_doc_type, title_template, …)
--   funkce nečte; jejich přítomnost nevadí.
--
-- Vzniklo vykostěním get_porada_recommendations (07-25); přestavěno 2026-09-24.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_doc_expiry_review_block(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
-- ⛔ SECURITY INVOKER, NE DEFINER — sesterská oprava k get_twin_ref_review_block
-- (bezpečnostní oprava 2026-07-31). Jako DEFINER obcházela RLS nad
-- li_source_registry a pouštěla data každému PŘIHLÁŠENÉMU.
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  with cfg as (
    select nullif(btrim(p_params->>'doc_type'), '')      as dtype,
           nullif(btrim(p_params->>'date_field'), '')    as dfield,
           case lower(coalesce(nullif(btrim(p_params->>'direction'), ''), 'upcoming'))
             when 'upcoming' then 'upcoming'
             when 'expired'  then 'expired'
           end                                           as dir,
           nullif(btrim(p_params->>'owner_company'), '') as owner,
           coalesce(nullif(btrim(p_params->>'date_label_key'), ''), 'app.cols.valid_to') as date_label,
           least(greatest(coalesce(nullif(p_params->>'limit', '')::int, 100), 1), 500) as lim
  ),
  univerzum as (
    -- Datum z OCR se bere, jen když je to SKUTEČNÉ datum ve tvaru ISO. CASE drží
    -- pořadí vyhodnocení: přetypování `'2026-02-30'::date` by jinak shodilo celý
    -- blok, kdyby plánovač podmínku `vdate >= dnes` vyhodnotil před kontrolou.
    select r.doc_slug                                          as id,
           coalesce(r.fields->'counterparty'->>'value', '—')   as counterparty,
           coalesce(r.filename, r.doc_slug)                    as filename,
           coalesce(r.fields->'owner_company'->>'value', '—')  as owner_company,
           case
             when (r.fields->cfg.dfield->>'value') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
              and pg_input_is_valid(r.fields->cfg.dfield->>'value', 'date')
             then (r.fields->cfg.dfield->>'value')::date
           end                                                 as vdate,
           r.created_at
    from li_source_registry r
    cross join cfg
    where r.superseded_by is null
      and r.doc_slug is not null
      and r.doc_type = cfg.dtype
      and (cfg.owner is null or r.fields->'owner_company'->>'value' = cfg.owner)
  ),
  s_datem as (
    select * from univerzum where vdate is not null
  ),
  vybrane as (
    select s.*
    from s_datem s
    cross join cfg
    where (cfg.dir = 'upcoming' and s.vdate >= current_date)
       or (cfg.dir = 'expired'  and s.vdate <  current_date)
    -- Nejbližší dnešku první v obou směrech: co končí nejdřív / co skončilo naposledy.
    order by abs(s.vdate - current_date), s.id
    limit (select lim from cfg)
  ),
  cerstvost as (
    select max(created_at) as fresh from s_datem
  ),
  sloupce as (
    select jsonb_build_array(
             jsonb_build_object('key', 'counterparty',  'label_key', 'app.wb.col.counterparty'),
             jsonb_build_object('key', 'filename',      'label_key', 'app.wb.col.filename'),
             jsonb_build_object('key', 'owner_company', 'label_key', 'app.wb.col.owner_company'),
             jsonb_build_object('key', 'date',          'label_key', cfg.date_label, 'align', 'right'))
           || case when cfg.dir = 'expired' then jsonb_build_array(
             jsonb_build_object('key', 'days',          'label_key', 'app.cols.days_expired', 'align', 'right'))
              else '[]'::jsonb end as c
    from cfg
  )
  select case
    -- ⛔ NÁROK, NE JEN PŘIHLÁŠENÍ (naměřeno 2026-09-11): blok čte smlouvy celého
    -- podniku; guard ověřoval jen přihlášení, takže je viděl kterýkoli řidič.
    -- Odmítnutí i chybějící konfigurace vydají PLATNOU prázdnou tabulku
    -- (`columns: []` je podle kontraktu poctivé „o ničem") — důvod nese `trace_id`.
    when not (public.is_admin_or_staff() or public.is_service_role()) then
      jsonb_build_object('data', jsonb_build_object('columns', '[]'::jsonb, 'rows', '[]'::jsonb,
          'row_kind', 'document'),
        'provenance', jsonb_build_object(
          'source_slug', 'li-source-registry',
          'trace_id', 'doc-expiry:unauthenticated',
          'freshness_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
    when (select dtype from cfg) is null or (select dfield from cfg) is null
      or (select dir from cfg) is null then
      jsonb_build_object('data', jsonb_build_object('columns', '[]'::jsonb, 'rows', '[]'::jsonb,
          'row_kind', 'document'),
        'provenance', jsonb_build_object(
          'source_slug', 'li-source-registry',
          'trace_id', 'doc-expiry:missing_config',
          'freshness_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
    else jsonb_build_object(
      'data', jsonb_build_object(
        'columns', (select c from sloupce),
        'row_kind', 'document',
        'rows', coalesce(
          (select jsonb_agg(
                    jsonb_build_object(
                      'id', v.id,
                      'counterparty', v.counterparty,
                      'filename', v.filename,
                      'owner_company', v.owner_company,
                      'date', to_char(v.vdate, 'YYYY-MM-DD'))
                    || case when (select dir from cfg) = 'expired'
                         then jsonb_build_object('days', current_date - v.vdate)
                         else '{}'::jsonb end
                    order by abs(v.vdate - current_date), v.id)
           from vybrane v), '[]'::jsonb)),
      'provenance', jsonb_build_object(
        'source_slug', 'li-source-registry',
        'trace_id', 'doc-expiry:' || (select dtype from cfg) || ':' || (select dir from cfg)
                    || case when (select fresh from cerstvost) is null then ':no_data' else '' end,
        'freshness_at', to_char(coalesce((select fresh from cerstvost), now()) at time zone 'UTC',
                                'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
        || public.scope_applied(p_params, 'owner_company'))
  end;
$$;

REVOKE ALL ON FUNCTION public.get_doc_expiry_review_block(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_doc_expiry_review_block(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_doc_expiry_review_block(jsonb) TO service_role;
