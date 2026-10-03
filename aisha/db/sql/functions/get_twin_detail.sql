-- Data RPC pro 'record_detail' blok: karta JEDNOHO twinu (měřidlo, vozidlo,
-- jednotka, firma, řidič…). SECURITY INVOKER — viditelnost rozhoduje RLS na
-- twin_entities, stejně jako u get_twin_register, který na tuhle kartu vede.
--
-- Rozsah = JEDEN twin (p_params->>'twin_id' z workbench.detail_by_kind.twin).
-- To je záměr, ne náhoda: dosah bloku je daný tím, o čem blok je — karta
-- jednoho twinu nesmí číst svět (rozhodnutí majitele 2026-08-31 po naměření
-- bloků počítajících nad vším).
--
-- Metadata twinů mají DVA TVARY a oba jsou legitimní:
--   1. ruční/XLSX (meter, unit): ploché klíče (adresa, lokalita, cislo_om…)
--      → každý skalár je pole karty, stav 'human_confirmed' (kurátor zapsal).
--   2. ingestové (company, driver, vehicle): obálka enginu {parameters,
--      period, confidence, …} → do karty jdou JEN stabilní parametry
--      (stable=true, jedna dominantní hodnota); distribuce s tisíci pozorování
--      nejsou materiál karty, ale analytiky. `support` dominantní hodnoty se
--      mapuje na `confidence` pole (obojí je podíl 0..1).
--
-- U měřidla navíc stav odečtového kola: krok šablony 'Odečet měřidla' pro
-- jeho číslo OM. Hodnota se NEVYMÝŠLÍ — dokud krok není completed, karta
-- říká 'čeká na odečet' přes value_key (i18n), ne prázdnem ani odhadem.
--
-- Vazby: počet POTVRZENÝCH řádků v twin_relations. Dnes 0 u všech — to je
-- pravdivý stav (návrhy z ingestu čekají na ratifikaci) a karta ho ukazuje,
-- neschovává. Návrhy samotné sem nepatří: jsou advisory, ne fakt.
--
-- Popisky polí jdou do app.wb.field.* — TÝŽ jmenný prostor jako pole dokladů,
-- protože stabilní parametry firem/vozidel JSOU slovník dokladů (delivery_date,
-- counterparty…): jeden překlad slouží oběma kartám. Nepřeložený klíč se
-- ukazuje viditelně — to je vlastnost (i18n.ts), ne vada.
--
-- Kontrakt: (jsonb) -> jsonb {data:{record_id,badges,fields,quote}, provenance}.
-- Prázdná větev drží TVAR kontraktu (viz get_document_detail — `error` navíc
-- shodil celý blok) a nerozlišuje „neexistuje" od „nesmíš vidět".

create or replace function public.get_twin_detail(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with pid as (
    -- uuid se NEcastuje naslepo: nevalidní vstup je běžný stav (ručně upravená
    -- URL), ne důvod k výjimce — výjimka by z bloku udělala orákulum na tvar.
    select case
      when coalesce(p_params->>'twin_id', '')
           ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (p_params->>'twin_id')::uuid
    end as id
  ),
  tw as (
    select t.* from public.twin_entities t, pid where t.id = pid.id limit 1
  ),
  ploche as (
    -- Tvar 1: ploché skaláry. Obálkové klíče enginu se přeskakují — patří
    -- tvaru 2 a jako "pole karty" by byly šum (export_id, exclusivity…).
    select jsonb_agg(
             jsonb_build_object(
               'key',       f.key,
               'label_key', 'app.wb.field.' || f.key,
               'value',     f.value #>> '{}',
               'state',     'human_confirmed'
             ) order by f.key
           ) as arr
    from tw, lateral jsonb_each(tw.metadata) as f
    where jsonb_typeof(tw.metadata) = 'object'
      and jsonb_typeof(f.value) in ('string', 'number')
      and f.key not in ('confidence', 'engine_version', 'exclusivity', 'export_id')
  ),
  stabilni as (
    -- Tvar 2: stabilní parametry profilu. Dominantní hodnota + její support.
    select jsonb_agg(
             jsonb_build_object(
               'key',        p.key,
               'label_key',  'app.wb.field.' || p.key,
               'value',      p.value->'values'->0->>'value',
               'state',      'auto_pass',
               'confidence', least(greatest(coalesce((p.value->'values'->0->>'support')::numeric, 0), 0), 1)
             ) order by p.key
           ) as arr
    from tw, lateral jsonb_each(tw.metadata->'parameters') as p
    where jsonb_typeof(tw.metadata->'parameters') = 'object'
      and p.value->>'stable' = 'true'
  ),
  obdobi as (
    select jsonb_build_array(jsonb_build_object(
             'key', 'obdobi', 'label_key', 'app.wb.field.obdobi',
             'value', (tw.metadata->'period'->>0) || ' – ' || (tw.metadata->'period'->>1),
             'state', 'auto_pass'
           )) as arr
    from tw where jsonb_typeof(tw.metadata->'period') = 'array'
  ),
  odecet as (
    -- Poslední krok odečtového kola pro číslo OM tohoto twinu. Šablona se
    -- pozná přes batch → template, ne textem kroku — krok se může jmenovat
    -- jinak, šablona je identita procesu.
    select jsonb_build_array(
             jsonb_build_object(
               'key', 'odecet_obdobi', 'label_key', 'app.wb.field.odecet_obdobi',
               'value', s.input_data->>'obdobi', 'state', 'auto_pass'),
             case when s.status = 'completed' and s.output_data ? 'value'
               then jsonb_build_object(
                 'key', 'odecet_stav', 'label_key', 'app.wb.field.odecet_stav',
                 'value', s.output_data->>'value', 'state', 'human_confirmed')
               else jsonb_build_object(
                 'key', 'odecet_stav', 'label_key', 'app.wb.field.odecet_stav',
                 'value_key', 'app.wb.value.odecet_ceka')
             end
           ) as arr
    from tw
    join public.production_workflow_steps s
      on s.input_data->>'cislo_om' = tw.metadata->>'cislo_om'
    join public.production_batches b on b.id = s.batch_id
    join public.production_workflow_templates tpl on tpl.id = b.workflow_template_id
    where tw.entity_type = 'meter'
      and coalesce(tw.metadata->>'cislo_om', '') <> ''
      and tpl.name = 'Odečet měřidla'
    order by s.created_at desc
    limit 1
  ),
  -- ⭐ PARAMETRY V ČASE (2026-09-28): poslední hodnota každého parametru z twin_events —
  -- TÝŽ zdroj jako registr dvojčat (get_twin_register). Naměřeno: seznam jednotek ukazoval
  -- nájemce a obsazenost (97/121 obsazeno), detail jen adresu, lokalitu a pronajímatele
  -- („chybí, kdo ji pronajímá a komu"). Hodnota, kterou už nese tvar 1 (metadata), se
  -- neopakuje. Popisek je týž klíč jako sloupec registru (app.twins.col.<kód>).
  parametry as (
    select jsonb_agg(
             jsonb_build_object(
               'key',       l.code,
               'label_key', 'app.twins.col.' || l.code,
               'value',     l.val,
               'state',     'auto_pass'
             ) order by l.code
           ) as arr
    from (
      select distinct on (e.attrs->>'code') e.attrs->>'code' as code, e.attrs->>'value' as val
        from tw
        join public.twin_events e on e.twin_id = tw.id
       where e.attrs ? 'code' and coalesce(e.attrs->>'value', '') <> ''
       order by e.attrs->>'code', e.occurred_at desc
    ) l
    where not exists (
      select 1 from tw, jsonb_each(tw.metadata) f
       where jsonb_typeof(tw.metadata) = 'object'
         and jsonb_typeof(f.value) in ('string', 'number')
         and lower(btrim(f.value #>> '{}')) = lower(btrim(l.val)))
  ),
  vazby as (
    select jsonb_build_array(jsonb_build_object(
             'key', 'vazby', 'label_key', 'app.wb.field.vazby',
             'value', count(r.id)::text
           )) as arr
    from tw
    left join public.twin_relations r
      on r.source_twin_id = tw.id or r.target_twin_id = tw.id
    group by tw.id
  )
  select coalesce(
    (select jsonb_build_object(
       'data', jsonb_build_object(
         'record_id', tw.id::text,
         'badges', jsonb_build_array(
           'app.twin.type.' || tw.entity_type,
           'app.twin.status.' || coalesce(nullif(tw.status, ''), 'active')
         ),
         'fields',
           coalesce((select arr from ploche),  '[]'::jsonb)
           || coalesce((select arr from stabilni), '[]'::jsonb)
           || coalesce((select arr from parametry), '[]'::jsonb)
           || coalesce((select arr from obdobi),   '[]'::jsonb)
           || coalesce((select arr from odecet),   '[]'::jsonb)
           || coalesce((select arr from vazby),    '[]'::jsonb),
         'quote', tw.label
       ),
       'provenance', jsonb_build_object(
         'source_slug',  'twin-core',
         'freshness_at', to_char(tw.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
         'trace_id',     'twin-detail:' || tw.id::text
       )
     ) from tw),
    jsonb_build_object(
      'data', jsonb_build_object('record_id', null, 'badges', '[]'::jsonb, 'fields', '[]'::jsonb),
      'provenance', jsonb_build_object(
        'source_slug',  'twin-core',
        'trace_id',     'twin-detail',
        'freshness_at', now())));
$$;

revoke all on function public.get_twin_detail(jsonb) from public, anon;
grant execute on function public.get_twin_detail(jsonb) to authenticated, service_role;
