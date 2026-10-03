-- Data RPC for a 'chart' block (kind='bar'): per-vehicle fuel consumption
-- (l/100 km) over the window, with average trip length as the point `note` so a
-- reader can normalise — short routes mean more cold starts and idling, hence a
-- structurally higher l/100 km, so the same number means different things at 42 km
-- and at 76 km. Points are ordered worst-first (highest consumption on top).
--
-- Reads Eurowag `trip` events off the twin substrate; a trip counts only when it
-- reports a plausible l/100 km (the plugin already dropped the −1 sentinel and the
-- physically-impossible short-trip spikes before the event was recorded).
-- Window is p_params->>'days' (default 7). SECURITY INVOKER → RLS on twin_* fails
-- closed. Contract: (jsonb) -> jsonb {data:{kind,unit_key,points[]}, provenance}.

create or replace function public.get_fleet_consumption(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with win as (
    select now() - make_interval(days => coalesce((p_params->>'days')::int, 7)) as since
  ),
  per as (
    select
      t.label,
      round(avg((e.attrs->>'consumption_l_100km')::numeric), 1) as l100,
      round(avg((e.attrs->>'distance_km')::numeric))            as avg_km
    from public.twin_events e
    join public.twin_entities t on t.id = e.twin_id
    where e.event_type = 'trip'
      and e.occurred_at >= (select since from win)
      and e.attrs->>'consumption_l_100km' ~ '^[0-9]+(\.[0-9]+)?$'
    group by t.label
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'kind', 'bar',
      'unit_key', 'app.fleet.unit.l100km',
      'points', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'label', per.label,
            'value', per.l100,
            -- `note` = Ø délka trasy (km) — čím se spotřeba normalizuje.
            'note',  coalesce(per.avg_km::text, '')
          ) order by per.l100 desc nulls last
        ) from per
      ), '[]'::jsonb)
    ),
    'provenance', jsonb_build_object(
      'source_slug',  'eurowag-telematics',
      'freshness_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'fleet-consumption'
    )
  );
$$;

revoke all on function public.get_fleet_consumption(jsonb) from public, anon;
grant execute on function public.get_fleet_consumption(jsonb) to authenticated, service_role;
