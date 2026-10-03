-- Data RPC for a 'table' block: the fuel balance per vehicle over the window —
--   natankováno (AVP `fueling`.liters) − spotřeba (Eurowag `trip`.consumption_l)
--   = Δ nádrž (kolik za týden v nádrži přibylo/ubylo)
-- with the last measured tank level as `sonda` (Eurowag `vehicle_state`.fuel_level_l,
-- populated only where the vehicle has a working CAN/probe — null otherwise, which
-- the renderer draws as '—', NOT as 0).
--
-- The Δ is why a naive "dispensed ≠ consumed" alarm is wrong: diesel goes into a
-- buffer stock in the tank, not into a leak. Only vehicles with fuelling OR trips
-- in the window appear. Reads three event types off the twin substrate; SECURITY
-- INVOKER → RLS on twin_* fails closed. Window is p_params->>'days' (default 7).
-- Contract: (jsonb) -> jsonb {data:{columns[],row_kind,rows[]}, provenance}.

create or replace function public.get_fleet_fuel_balance(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with win as (
    select now() - make_interval(days => coalesce((p_params->>'days')::int, 7)) as since
  ),
  fuel as (
    select twin_id, sum((attrs->>'liters')::numeric) as tanked
    from public.twin_events
    where event_type = 'fueling' and occurred_at >= (select since from win)
      and attrs->>'liters' ~ '^[0-9]+(\.[0-9]+)?$'
    group by twin_id
  ),
  cons as (
    select twin_id, sum((attrs->>'consumption_l')::numeric) as used
    from public.twin_events
    where event_type = 'trip' and occurred_at >= (select since from win)
      and attrs->>'consumption_l' ~ '^[0-9]+(\.[0-9]+)?$'
    group by twin_id
  ),
  sonda as (
    select distinct on (twin_id) twin_id,
      case when attrs->>'fuel_level_l' ~ '^[0-9]+(\.[0-9]+)?$' then (attrs->>'fuel_level_l')::numeric end as level
    from public.twin_events
    where event_type = 'vehicle_state'
    order by twin_id, occurred_at desc
  ),
  reg as (
    select
      t.id, t.label,
      coalesce(f.tanked, 0) as tanked,
      coalesce(c.used, 0)   as used,
      coalesce(f.tanked, 0) - coalesce(c.used, 0) as delta,
      s.level
    from public.twin_entities t
    left join fuel  f on f.twin_id = t.id
    left join cons  c on c.twin_id = t.id
    left join sonda s on s.twin_id = t.id
    where t.entity_type = 'vehicle'
      and (f.tanked is not null or c.used is not null)
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'row_kind', 'twin',
      'columns', jsonb_build_array(
        jsonb_build_object('key','label', 'label_key','app.fleet.col.vehicle', 'align','left'),
        jsonb_build_object('key','tanked','label_key','app.fleet.col.tanked',  'align','right'),
        jsonb_build_object('key','used',  'label_key','app.fleet.col.used',    'align','right'),
        jsonb_build_object('key','delta', 'label_key','app.fleet.col.delta',   'align','right'),
        jsonb_build_object('key','sonda', 'label_key','app.fleet.col.sonda',   'align','right')
      ),
      'rows', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id',     reg.id::text,
            'label',  reg.label,
            'tanked', round(reg.tanked),
            'used',   round(reg.used),
            'delta',  round(reg.delta),
            'sonda',  reg.level  -- null = neměřeno (renderer kreslí '—')
          ) order by reg.delta desc nulls last
        ) from reg
      ), '[]'::jsonb)
    ),
    'provenance', jsonb_build_object(
      'source_slug',  'avp-portal+eurowag-telematics',
      'freshness_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'fleet-fuel-balance'
    )
  );
$$;

revoke all on function public.get_fleet_fuel_balance(jsonb) from public, anon;
grant execute on function public.get_fleet_fuel_balance(jsonb) to authenticated, service_role;
