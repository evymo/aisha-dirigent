-- Data RPC for a 'findings' block: „co vyřídit" — deterministic fleet findings
-- DERIVED from the twin substrate (not a passthrough read). Each finding carries a
-- catalogue rule id as title_key (i18n, never a literal) + severity + grounded
-- `fields` (the numbers that fired it). Two rules today, both computable from what
-- the connectors already record:
--   • unassigned_driver — km driven on trips with no resolved driver (related twin
--     null), summed per vehicle over a threshold. A compliance gap: a card must be
--     pulled from the unit, or the ride has no legal driver.
--   • speeding — overspeed segments from Webdispečink (wd_overspeed) above the
--     limit, per vehicle, WITH the location of the fastest one. For 12t+ the
--     limiter should hold 90; repeated overspeed is a workshop item, not a talk.
-- More rules (missing-from-fleet, tacho-silent) need context this reader does not
-- yet have and are left out rather than faked.
--
-- SECURITY INVOKER → RLS on twin_* fails closed. Window p_params->>'days' (7);
-- p_params->>'speed_limit_kmh' (100), p_params->>'min_unassigned_km' (100).
-- Contract: (jsonb) -> jsonb {data:{items[]}, provenance}.

-- ⭐ ČERSTVOST Z DAT (brána `cerstvost-z-dat`, 2026-09-27): `freshness_at` = nejnovější čas
-- univerza bloku, spočtený ze STEJNÝCH řádků jako hodnota. Pořadí zdrojů času: čas ze zdroje
-- (u Money `source_modified_at`, až bude úplný; u jízd/událostí `occurred_at`) › příchod verze
-- dokladu (`created_at`). NE `ingested_at`/`updated_at` — ty přepisuje KAŽDÝ import (naměřeno
-- 2026-09-27: 813 smluv = jediný čas), takže by lhaly jako faktury zamrzlé na exportu ze 6. 8.
-- Hranice `created_at`: backfill starých dokladů má čas dnešní — pravda o příchodu, ne o obsahu.
-- Prázdné univerzum → `trace_id` nese `:no_data` a čas je jen záloha `coalesce(…, now())`.
-- Stav linky (běží/neběží) sem NEPATŘÍ — je to jiný signál.
create or replace function public.get_fleet_findings(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with p as (
    select coalesce((p_params->>'days')::int, 7)                       as days,
           -- 12t+ tahače: omezovač drží 90, cokoli výš je porušení.
           coalesce((p_params->>'speed_limit_kmh')::numeric, 90)       as speed_limit,
           coalesce((p_params->>'min_unassigned_km')::numeric, 100)    as min_km
  ),
  win as (select now() - make_interval(days => (select days from p)) as since),
  cerstvost as (
    select greatest(
      (select max(e.occurred_at) from public.twin_events e
        where e.event_type = 'trip' and e.occurred_at >= (select since from win)),
      (select max(o.time_from) from public.wd_overspeed o
        where o.time_from >= (select since from win))) as fresh
  ),
  unassigned as (
    select t.id, t.label, sum((e.attrs->>'distance_km')::numeric) as km
    from public.twin_events e
    join public.twin_entities t on t.id = e.twin_id
    where e.event_type = 'trip'
      and e.occurred_at >= (select since from win)
      and e.related_twin_id is null
      and e.attrs->>'distance_km' ~ '^[0-9]+(\.[0-9]+)?$'
    group by t.id, t.label
    having sum((e.attrs->>'distance_km')::numeric) >= (select min_km from p)
  ),
  -- Překročení rychlosti z Webdispečinku (wd_overspeed) — narozdíl od dopočtu
  -- z telematiky nese POLOHU, čas i řidiče. Vrací nejrychlejší úsek jako místo.
  speeding as (
    select
      v.wd_car_id as id,
      v.identifier as label,
      count(*)     as cnt,
      max(o.max_speed_kmh) as max_speed,
      (array_agg(
         round(o.lat, 4)::text || ', ' || round(o.lon, 4)::text
         order by o.max_speed_kmh desc
       ) filter (where o.lat is not null and o.lon is not null))[1] as top_loc
    from public.wd_overspeed o
    join public.wd_vehicles v on v.wd_car_id = o.wd_car_id
    where o.time_from >= (select since from win)
      and o.max_speed_kmh > (select speed_limit from p)
    group by v.wd_car_id, v.identifier
  ),
  items as (
    select 'unassigned:' || id::text as id,
           'app.fleet.finding.unassigned_driver'    as title_key,
           'high'                                    as severity,
           jsonb_build_array(
             jsonb_build_object('key','vehicle','label_key','app.fleet.col.vehicle',        'value', label),
             jsonb_build_object('key','km',     'label_key','app.fleet.col.unassigned_km',  'value', round(km))
           )                                         as fields
    from unassigned
    union all
    select 'speeding:' || id::text,
           'app.fleet.finding.speeding',
           'medium',
           jsonb_build_array(
             jsonb_build_object('key','vehicle',  'label_key','app.fleet.col.vehicle',   'value', label),
             jsonb_build_object('key','count',    'label_key','app.fleet.col.count',     'value', cnt),
             jsonb_build_object('key','max_speed','label_key','app.fleet.col.max_speed', 'value', round(max_speed)),
             jsonb_build_object('key','location', 'label_key','app.fleet.col.location',  'value', top_loc)
           )
    from speeding
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(
          jsonb_build_object('id', id, 'title_key', title_key, 'severity', severity, 'fields', fields)
          order by case severity when 'high' then 1 when 'medium' then 2 else 3 end, id
        ) from items
      ), '[]'::jsonb)
    ),
    'provenance', jsonb_build_object(
      'source_slug',  'webdispecink-fleet+twin-core',
      'freshness_at', to_char(coalesce((select fresh from cerstvost), now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'fleet-findings'
                      || case when (select fresh from cerstvost) is null then ':no_data' else '' end
    )
  );
$$;

revoke all on function public.get_fleet_findings(jsonb) from public, anon;
grant execute on function public.get_fleet_findings(jsonb) to authenticated, service_role;
