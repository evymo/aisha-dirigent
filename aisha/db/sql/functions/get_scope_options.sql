-- VOLBY POHLEDU — čím vším smí uživatel omezit, na co se dívá.
--
-- Přepínač pohledu potřebuje seznam možností. Ten seznam NESMÍ být v kódu klienta
-- ani v překladech: která firma existuje a kolik má dokladů je vlastnost PODNIKU
-- a mění se bez releasu. Klient se proto ptá a dostane, co v datech skutečně je —
-- včetně počtu, protože „firma se třemi doklady" a „firma s osmnácti tisíci" jsou
-- pro volbu pohledu různě zajímavé.
--
-- ⭐ VOLBY SE ODVOZUJÍ, NEUDRŽUJÍ
-- Žádný číselník, který by se rozešel se skutečností. Zdroj je buď registr dokladů
-- (pole hlavičky, typicky `owner_company` = za kterou z našich firem doklad je),
-- nebo twin parametr (`unit_landlord`, `unit_site`…). Obojí je táž otázka položená
-- nad jiným substrátem, takže je to jedna funkce s parametrem, ne dvě.
--
-- ⭐ 2026-09-06 (ADR-003 K5): druhů substrátu je šest, ne dva. Osy, které K5
-- jmenuje — druh entity, vazba, skupina, rodina šablon — se dosud odvodit
-- nedaly, takže přepínač uměl mluvit jen o dokladech a jednotkách. Každý nový
-- druh je tu VĚTEV NAD JINÝM SUBSTRÁTEM, ne nová funkce: otázka „co všechno
-- v datech je" je pořád jedna.
--
-- Konfigurace (p_params):
--   source : druh substrátu, výchozí 'registry'
--            'registry'  pole hlavičky dokladu (li_source_registry)
--            'twin'      hodnota twin parametru (twin_events.attrs code/value)
--            'twin_kind' DRUH ENTITY (twin_entities.entity_type)
--            'relation'  VAZBA (twin_relations.relation_kind, jen platné)
--            'label'     SKUPINA / štítek (story_labels.label nad druhem zdroje)
--            'template'  RODINA ŠABLON (jméno šablony běhu + počet běhů)
--   key    : název pole hlavičky (registry), kód twin parametru (twin),
--            resp. druh zdroje štítku (label; default 'actor')
--   entity_type : jen pro source='twin' — nad kterou doménou (default 'unit')
--   limit  : kolik voleb (default 50, strop 200)
--
-- SECURITY INVOKER → RLS rozhoduje: kdo na doklady nárok nemá, dostane prázdný
-- seznam, ne chybu. Přepínač tak sám od sebe nabízí jen to, co uživatel smí vidět,
-- a nemusí se to nikde podruhé hlídat.
--
-- Kontrakt: (jsonb) -> jsonb {data:{dim, options:[{value,count}]}, provenance}.

create or replace function public.get_scope_options(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with cfg as (
    select
      coalesce(nullif(p_params->>'source', ''), 'registry')          as zdroj,
      coalesce(nullif(p_params->>'key', ''),
               case when p_params->>'source' = 'label' then 'actor'
                    else 'owner_company' end)                          as klic,
      coalesce(nullif(p_params->>'entity_type', ''), 'unit')         as typ,
      least(coalesce(nullif(p_params->>'limit', '')::int, 50), 200)  as lim
  ),
  -- ⭐ 2026-09-29: výchozí osa `owner_company` čte GENEROVANÝ sloupec registru, ne
  -- `fields`. Agregace přes celý registr jinak rozbaluje JSON každého dokladu
  -- (riq jako správce: 777–973 ms; přes prostý sloupec 85–100 ms). Výsledek je
  -- TÝŽ: sloupec = `fields->'owner_company'->>'value'` a řádek s klíčem bez hodnoty
  -- (`fields ? klic`, hodnota NULL) by `souhrn` níž stejně zahodil. Ostatní klíče
  -- (dynamické) dál přes `fields`.
  z_registru as (
    select r.owner_company_value as hodnota
    from public.li_source_registry r, cfg
    where cfg.zdroj = 'registry'
      and cfg.klic = 'owner_company'
      and r.superseded_by is null
      and r.owner_company_value is not null
    union all
    select r.fields->(select klic from cfg)->>'value' as hodnota
    from public.li_source_registry r, cfg
    where cfg.zdroj = 'registry'
      and cfg.klic <> 'owner_company'
      and r.superseded_by is null
      and r.fields ? cfg.klic
  ),
  -- Twin varianta bere POSLEDNÍ hodnotu parametru per entita, aby se přejmenovaná
  -- firma nepočítala dvakrát (jednou pod starým a jednou pod novým jménem).
  z_twinu as (
    select distinct on (e.twin_id) e.attrs->>'value' as hodnota
    from public.twin_events e
    join public.twin_entities t on t.id = e.twin_id
    cross join cfg
    where cfg.zdroj = 'twin'
      and t.entity_type = cfg.typ
      and e.attrs->>'code' = cfg.klic
    order by e.twin_id, e.occurred_at desc
  ),
  -- DRUH ENTITY. Počet = kolik entit toho druhu je; „osob 812" a „firem 9" je
  -- pro volbu pohledu jiná informace než holý seznam.
  z_druhu as (
    select t.entity_type as hodnota
    from public.twin_entities t, cfg
    where cfg.zdroj = 'twin_kind'
  ),
  -- VAZBA. Jen platné vazby (valid_to is null) — zrušené členství není osa,
  -- pod kterou by se dnes někdo chtěl dívat.
  z_vazeb as (
    select r.relation_kind as hodnota
    from public.twin_relations r, cfg
    where cfg.zdroj = 'relation'
      and r.valid_to is null
  ),
  -- SKUPINA (štítek). `key` říká, nad jakým DRUHEM zdroje se ptáme (actor,
  -- story, campaign…), ne jméno konkrétní skupiny.
  z_stitku as (
    select l.label as hodnota
    from public.story_labels l, cfg
    where cfg.zdroj = 'label'
      and l.resource_type = cfg.klic
  ),
  -- RODINA ŠABLON. Hodnota je JMÉNO šablony, protože právě jménem šablony
  -- filtruje věž (get_timing_tower_block, parametr `template`); počet je počet
  -- běhů, takže šablona bez jediného běhu se nabízí až za těmi živými.
  z_sablon as (
    select tpl.name as hodnota
    from public.production_batches b
    join public.production_workflow_templates tpl on tpl.id = b.workflow_template_id
    cross join cfg
    where cfg.zdroj = 'template'
  ),
  vse as (
    select hodnota from z_registru
    union all select hodnota from z_twinu
    union all select hodnota from z_druhu
    union all select hodnota from z_vazeb
    union all select hodnota from z_stitku
    union all select hodnota from z_sablon
  ),
  souhrn as (
    select hodnota, count(*) as pocet
    from vse
    where hodnota is not null and btrim(hodnota) <> ''
    group by hodnota
    order by count(*) desc, hodnota
    limit (select lim from cfg)
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'dim', (select klic from cfg),
      'options', coalesce((
        select jsonb_agg(jsonb_build_object('value', s.hodnota, 'count', s.pocet)
                         order by s.pocet desc, s.hodnota)
        from souhrn s), '[]'::jsonb)
    ),
    'provenance', jsonb_build_object(
      'source_slug',  case (select zdroj from cfg)
                        when 'twin'      then 'twin-core'
                        when 'twin_kind' then 'twin_entities'
                        when 'relation'  then 'twin_relations'
                        when 'label'     then 'story_labels'
                        when 'template'  then 'production_workflow_templates'
                        else 'li-source-registry' end,
      'freshness_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'scope-options:' || (select zdroj from cfg)
    )
  );
$$;

comment on function public.get_scope_options(jsonb) is
  'Volby přepínače pohledu ODVOZENÉ z dat (registr dokladů nebo twin parametr), s počty. Žádný číselník, který by se rozešel se skutečností; SECURITY INVOKER, takže nabídne jen to, na co má volající nárok.';

revoke all on function public.get_scope_options(jsonb) from public, anon;
grant execute on function public.get_scope_options(jsonb) to authenticated, service_role;
