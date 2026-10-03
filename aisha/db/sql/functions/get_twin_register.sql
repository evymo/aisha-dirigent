-- Data RPC for a 'table' block: a domain register over the twin substrate.
-- ONE generic reader serves ANY entity_type (meter, and every future domain)
-- because the domain is a PARAMETER (p_params->>'entity_type'), not code — a new
-- analytical area is a row in surface_blocks with different source_params, never a
-- new function. Columns are derived from twin_parameter_definitions for that type;
-- each row is a twin_entity plus its latest value per parameter from twin_events.
--
-- Seam, not new domain: it is a pure READ join of three existing substrates
-- (twin_entities × twin_events × twin_parameter_definitions) exposed through the
-- existing get_block_data dispatcher, mirroring get_document_register/get_obligation_queue.
-- SECURITY INVOKER → RLS on twin_* fails closed (non-staff get an empty register,
-- not an error), same doctrine as the li_* readers.
--
-- Contract: (jsonb) -> jsonb {data:{entity_kind, columns[], rows[]}, provenance}.

create or replace function public.get_twin_register(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with cfg as (
    -- ⭐ OSA „PODLE FIRMY" (2026-09-28). Zvolená firma (`owner_company`, hodnota z hlavičky
    -- dokladu) chodí do každého bloku sekce, ale registr twinů ji nemá kde přečíst —
    -- twin nemá hlavičku. Jak firmu na doménu PŘELOŽIT, řekne konfigurace bloku
    -- (`source_params.scope_map.owner_company`), protože u jednotek a u nájemců je to jiná
    -- cesta a obě musí vést přes IDENTITU, ne přes jméno (jméno není identita —
    -- counterparty_resolve; naměřeno 2026-09-28: pronajímatel „Areál Avant Ďáblická,
    -- družstvo" u 23 jednotek ≠ agenda „Areál Avant Ďáblická", textová shoda by je tiše ztratila):
    --   via 'doc_field' {param, doc_field}   twin, jehož poslední hodnota parametru `param`
    --        je v poli `doc_field` některého platného dokladu té firmy (nájemce ↔ IČO
    --        protistrany dokladů: company_ico ∈ counterparty_id).
    --   via 'relation' {relation_kind, target_ref}   twin s PLATNOU vazbou `relation_kind`
    --        (twin = zdroj hrany) na twin, který nese POTVRZENÝ odkaz `target_ref` s klíčem
    --        = zvolená firma (jednotka —pronajimatel→ naše firma; „naše firma" potvrzuje člověk).
    -- Bez konfigurace blok osu nečte a neohlásí ji (scope_applied) — klient ho označí jako
    -- nefiltrovaný. Neznámé `via` = totéž, nic se neodhaduje.
    select nullif(p_params->>'owner_company', '')                      as firma,
           p_params#>>'{scope_map,owner_company,via}'                  as via,
           p_params#>>'{scope_map,owner_company,param}'                as param,
           p_params#>>'{scope_map,owner_company,doc_field}'            as doc_field,
           p_params#>>'{scope_map,owner_company,relation_kind}'        as rel_kind,
           p_params#>>'{scope_map,owner_company,target_ref}'           as target_ref
  ),
  cols as (
    -- Leading 'label' column = the entity name (twin.label), so a register row reads
    -- "which entity + its parameters" (the mobile BlockRenderer shows the first 3 columns).
    select (
      jsonb_build_array(jsonb_build_object(
        'key', 'label', 'label', 'Název', 'label_key', 'app.twins.col.label', 'align', 'left'
      ))
      || coalesce(jsonb_agg(
             jsonb_build_object(
               'key',       d.code,
               'label',     d.name,
               'label_key', 'app.twins.col.' || d.code,
               'unit',      d.unit,
               'align',     case when d.data_type in ('decimal','numeric','integer','number') then 'right' else 'left' end
             ) order by d.code
           ), '[]'::jsonb)
    ) as columns
    from public.twin_parameter_definitions d
    where d.entity_type = coalesce(nullif(p_params->>'entity_type', ''), 'meter')
      -- Registr ukazuje, JAKÁ entita je (stav, atributy), ne kolik se jí za okno
      -- přihodilo. Veličina vedená jako záznam událostí (`event_log`: ujeto,
      -- natankováno) „poslední hodnotu" nemá — patří do dlaždice nebo tabulky
      -- s oknem, ne do sloupce, který by zůstal navždy prázdný (produkce RIQ
      -- 2026-09-24: čtyři sloupce registru vozidel samé „—").
      and coalesce(d.historization, '') <> 'event_log'
  ),
  -- Kódy, jejichž hodnotu katalog vede v atributu události (čte je `latest_ev`).
  -- MATERIALIZED = katalog pod RLS se projde JEDNOU. Jako `not exists` přímo
  -- v `latest_cv` z něj planner udělal Nested Loop Anti Join a katalog procházel
  -- pro KAŽDOU událost: produkce 581 × ~1,1 ms = 646 ms, i u druhu bez jediné takové
  -- definice (jednotky 0,2–0,6 s → 1,0–1,3 s; 2026-09-30).
  kody_udalosti as materialized (
    select dd.code from public.twin_parameter_definitions dd where dd.metadata ? 'event_type'
  ),
  -- Hodnota ve tvaru {code,value} (atributy: RZ, VIN, jednotka…).
  latest_cv as (
    select distinct on (e.twin_id, e.attrs->>'code')
      e.twin_id,
      e.attrs->>'code'  as code,
      e.attrs->>'value' as val,
      e.occurred_at
    from public.twin_events e
    join public.twin_entities t on t.id = e.twin_id
    where t.entity_type = coalesce(nullif(p_params->>'entity_type', ''), 'meter')
      and e.attrs ? 'code'
      -- Kód, jehož hodnotu katalog vede v atributu události, se čte níž švem —
      -- jinak by jeden sloupec měl dva zdroje a vyhrál by ten náhodný.
      and not exists (select 1 from kody_udalosti k where k.code = e.attrs->>'code')
    order by e.twin_id, e.attrs->>'code', e.occurred_at desc
  ),
  -- Hodnota, která podle KATALOGU leží v atributu události (časová řada: hladina,
  -- tachometr). Čte se týmž švem jako čtečky veličin (`twin_param_values`), takže
  -- jednotku a převod určuje katalog na jednom místě, ne tady.
  -- `twin_param_values` má SET search_path, takže se NEinlinuje (Function Scan,
  -- ROWS 1000). Volá se po DEFINICI, ne po twinu — proto odhad drží a JIT nenaskočí.
  -- Nepřesouvat do laterálu po twinu (2026-09-30, Optimalizace).
  latest_ev as (
    select distinct on (v.twin_id, d.code)
      v.twin_id,
      d.code,
      trim_scale(v.value)::text as val,
      v.occurred_at
    from public.twin_parameter_definitions d
    cross join lateral public.twin_param_values(d.code, null, null, d.entity_type) v
    where d.entity_type = coalesce(nullif(p_params->>'entity_type', ''), 'meter')
      and d.metadata ? 'event_type'
      and coalesce(d.historization, '') <> 'event_log'
      and v.value is not null
    order by v.twin_id, d.code, v.occurred_at desc
  ),
  latest as (
    select twin_id, code, val, occurred_at from latest_cv
    union all
    select twin_id, code, val, occurred_at from latest_ev
  ),
  -- Hodnoty pole `doc_field` v platných dokladech zvolené firmy (osa přes `doc_field`).
  -- MATERIALIZED = spočítá se JEDNOU a každé další čtení bere hotový výsledek. Bez plotu
  -- planner (latest odhadne na 1 řádek, skutečně 69) prošel celý registr dokladů pro
  -- KAŽDÝ řádek latest: nájemci se zvolenou firmou 19–35 s (69 × 38 186 dokladů firmy,
  -- 2,6 mil. rozbalení jsonb; 2026-09-30). Mimo `doc_field` se nečte vůbec (one-time filtr).
  doc_hodnoty as materialized (
    select distinct d.fields->(select doc_field from cfg)->>'value' as val
      from public.li_source_registry d
     where (select via from cfg) = 'doc_field'
       and (select firma from cfg) is not null
       and d.superseded_by is null
       and d.fields->'owner_company'->>'value' = (select firma from cfg)
  ),
  reg as (
    select
      t.id::text as id,
      t.label,
      coalesce(jsonb_object_agg(l.code, l.val) filter (where l.code is not null), '{}'::jsonb) as vals,
      max(l.occurred_at) as _sort
    from public.twin_entities t
    left join latest l on l.twin_id = t.id
    where t.entity_type = coalesce(nullif(p_params->>'entity_type', ''), 'meter')
      and t.status = 'active'
      -- `has_param`: jen entity, o kterých TO KONKRÉTNÍ víme. Bez toho filtru vrací
      -- registr celou doménu — u firem 1 354 protistran z účetnictví místo devadesáti
      -- nájemců, a z přehledu je zase sklad. Doména není totéž co množina, na kterou
      -- se ptáme; filtr je proto parametr bloku, ne nová funkce.
      --
      -- ⛔ FILTRY NÍŽ JSOU NEKORELOVANÉ `t.id in (…)`, NE `exists (… = t.id)` (2026-09-30).
      -- Korelovanou EXISTS pod OR planner převede na AlternativeSubPlan a OCENÍ ji první
      -- (řádkovou) variantou, i když za běhu použije hashovanou: rameno `doc_field`
      -- (Hash Semi Join 33 180) × řádky twinů → odhad 132,7 mil. → plný JIT (268 funkcí)
      -- u KAŽDÉHO registru, i u 12 vozidel: 2,0–2,4 s místo 130–240 ms, výstup shodný.
      -- Nekorelovaný IN je hashovaný SubPlan oceněný JEDNOU. Týž vzor jako věž a časová
      -- osa (kolo 13); hlídá brána korelovana-exists-pod-or.
      and (nullif(p_params->>'has_param','') is null
           or t.id in (select he.twin_id from public.twin_events he
                        where he.attrs->>'code' = p_params->>'has_param'))
      -- `param_eq` {kód: hodnota}: jen entity, jejichž POSLEDNÍ hodnota parametru se rovná
      -- (2026-09-29, „neobsazené a volné prostory“ = unit_occupied 'ne'). has_param výš ptá
      -- jen na přítomnost; bez rovnosti by blok volných jednotek musel být vlastní funkce.
      -- Twin projde, když sedí VŠECHNY páry: počet shodných RŮZNÝCH kódů = počet párů
      -- (latest má jeden řádek na twin × kód a klíče objektu jsou jedinečné; distinct drží
      -- rovnost, i kdyby jedno z toho přestalo platit). Prázdný objekt `{}` nefiltruje —
      -- „žádný pár nechybí“ platí vždy — a počet 0 by jinak nepropustil nic.
      and (jsonb_typeof(p_params->'param_eq') is distinct from 'object'
           or p_params->'param_eq' = '{}'::jsonb
           or t.id in (
                select lq.twin_id
                  from latest lq
                  join jsonb_each_text(p_params->'param_eq') pe
                    on pe.key = lq.code and pe.value = lq.val
                 group by lq.twin_id
                having count(distinct lq.code) = (select count(*) from jsonb_each_text(p_params->'param_eq'))))
      and ((select firma from cfg) is null
           or (select via from cfg) is null
           or (select via from cfg) not in ('doc_field', 'relation')
           or ((select via from cfg) = 'doc_field' and t.id in (
                 select lf.twin_id from latest lf
                  where lf.code = (select param from cfg)
                    and lf.val in (select h.val from doc_hodnoty h)))
           or ((select via from cfg) = 'relation' and t.id in (
                 select rel.source_twin_id
                   from public.twin_relations rel
                   join public.twin_external_refs x on x.twin_id = rel.target_twin_id
                  cross join cfg
                  where rel.relation_kind = cfg.rel_kind
                    and rel.valid_from <= now()
                    and (rel.valid_to is null or rel.valid_to > now())
                    and x.ref_kind = cfg.target_ref
                    and x.state = 'confirmed'
                    and x.source_key = cfg.firma
                    and (x.valid_to is null or x.valid_to > now()))))
    group by t.id, t.label
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      -- `entity_kind` se sem ZÁMĚRNĚ nevrací (odstraněno 2026-08-08). Kontrakt
      -- tabulky ho nezná, žádný renderer ho nečetl — a přitom kvůli němu bloky
      -- nj_jednotky, nj_najemci a registry z obrazovky TIŠE mizely. Co řádek JE,
      -- říká `row_kind`; to je kanál, který na to existuje.
      'columns', (select columns from cols),
      -- `id` je twin, ne doklad. Druh řádku smí ZÚŽIT konfigurace bloku
      -- (`source_params.row_kind`, např. 'company' u registru nájemců): id je
      -- pořád twin, ale instance ho otevře jinou kartou (detail_by_kind) — firma
      -- kartou protistrany, vozidlo kartou twinu. Bez parametru beze změny.
      'row_kind', coalesce(nullif(p_params->>'row_kind', ''), 'twin'),
      'rows', coalesce((
        select jsonb_agg(
                 jsonb_build_object('id', reg.id, 'label', reg.label) || reg.vals
                 order by reg.label nulls last, reg.id
               )
        from reg
      ), '[]'::jsonb)
    ),
    'provenance', jsonb_build_object(
      'source_slug',  'twin-core',
      'freshness_at', to_char(coalesce((select max(_sort) from reg), now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'twin-register'
    ) || case when (select via from cfg) in ('doc_field', 'relation')
              then public.scope_applied(p_params, 'owner_company')
              else '{}'::jsonb end
  );
$$;

revoke all on function public.get_twin_register(jsonb) from public, anon;
grant execute on function public.get_twin_register(jsonb) to authenticated, service_role;
