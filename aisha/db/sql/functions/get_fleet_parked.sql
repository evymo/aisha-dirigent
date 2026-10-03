-- Data RPC for a 'table' block: odstavená vozidla — vehicles with no trip in the
-- idle window (default 14 days). Report mentions them in prose; this makes the
-- standing decision an evidenced row (last activity + days parked), so leasing/
-- insurance carried without revenue is visible, not narrated.
--
-- Reads twin_entities (active vehicles) LEFT JOIN their last `trip` event. A
-- vehicle with no trip at all, or none since the cutoff, is parked. SECURITY
-- INVOKER → RLS on twin_* fails closed. Window is p_params->>'idle_days'.
-- Contract: (jsonb) -> jsonb {data:{columns[],row_kind,rows[]}, provenance}.

create or replace function public.get_fleet_parked(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with p as (select coalesce((p_params->>'idle_days')::int, 14) as idle_days),
  last_trip as (
    select twin_id, max(occurred_at) as last_at
    from public.twin_events
    where event_type = 'trip'
    group by twin_id
  ),
  parked as (
    select
      t.id, t.label, lt.last_at,
      case when lt.last_at is null then null
           else floor(extract(epoch from (now() - lt.last_at)) / 86400)::int end as idle_days
    from public.twin_entities t
    left join last_trip lt on lt.twin_id = t.id
    where t.entity_type = 'vehicle'
      and t.status = 'active'
      and (lt.last_at is null
           or lt.last_at < now() - make_interval(days => (select idle_days from p)))
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'row_kind', 'twin',
      'columns', jsonb_build_array(
        jsonb_build_object('key','label',    'label_key','app.fleet.col.vehicle',  'align','left'),
        jsonb_build_object('key','last_trip','label_key','app.fleet.col.last_trip', 'align','left'),
        jsonb_build_object('key','idle_days','label_key','app.fleet.col.idle_days', 'align','right')
      ),
      'rows', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id',        parked.id::text,
            'label',     parked.label,
            'last_trip', case when parked.last_at is null then null
                             else to_char(parked.last_at at time zone 'UTC', 'YYYY-MM-DD') end,
            'idle_days', parked.idle_days  -- null = nikdy nejela v evidenci
          ) order by parked.idle_days desc nulls first, parked.label
        ) from parked
      ), '[]'::jsonb)
    ),
    'provenance', jsonb_build_object(
      'source_slug',  'twin-core',
      'freshness_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'fleet-parked'
    )
  );
$$;

revoke all on function public.get_fleet_parked(jsonb) from public, anon;
grant execute on function public.get_fleet_parked(jsonb) to authenticated, service_role;
