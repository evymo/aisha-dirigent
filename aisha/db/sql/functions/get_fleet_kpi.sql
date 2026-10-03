-- Data RPC for a 'kpi_tile' block: one headline figure for the fleet console
-- (surface `vozovy_park`), over the twin substrate the telematics connectors write.
-- The metric is chosen by p_params->>'metric' (seeded per block via source_params):
--   'km_week'         — kilometres driven in the window (Eurowag `trip`.distance_km)
--   'consumption_avg' — mean l/100 km over trips that report it (short-trip noise
--                       already filtered by the plugin before it becomes an event)
--   'diesel_week'     — litres dispensed in the window (AVP `fueling`.liters)
--   'active_vehicles' — distinct vehicles with a trip in the window
--   'tonnage_week' / 'exported_value' / 'invoiced_value' — Money-backed (tonnage,
--                       Kč). These land as DOCUMENTS (document_registry: delivery_note
--                       / invoice), NOT on the twin lane, and their extracted weight/
--                       price fields are not wired yet — so the metric is NEMĚŘENO
--                       (null → the tile shows '—'), never a fabricated 0.
-- Window is p_params->>'days' (default 7 — a week, matching the report the view grew from).
-- SECURITY INVOKER → RLS on twin_* fails closed (non-staff get an empty figure, not
-- an error), same doctrine as get_document_digest / get_twin_register.
-- Contract: (jsonb) -> jsonb {data:{value,unit_key,state}, provenance}.
--
-- `value = null` means NEMĚŘENO — the renderer draws '—'. A 0 would assert a
-- measurement that did not happen; until the sources are active and events flow,
-- the twin metrics are legitimately null too.

create or replace function public.get_fleet_kpi(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with p as (
    select coalesce(nullif(p_params->>'metric',''), 'km_week') as m,
           coalesce((p_params->>'days')::int, 7)               as days
  ),
  win as (select now() - make_interval(days => (select days from p)) as since),
  trips as (
    select e.twin_id, e.attrs
    from public.twin_events e
    where e.event_type = 'trip' and e.occurred_at >= (select since from win)
  ),
  fuelings as (
    select e.attrs
    from public.twin_events e
    where e.event_type = 'fueling' and e.occurred_at >= (select since from win)
  ),
  v as (
    select case (select m from p)
      when 'km_week' then
        (select sum((attrs->>'distance_km')::numeric)
           from trips where attrs->>'distance_km' ~ '^-?[0-9]+(\.[0-9]+)?$')
      when 'consumption_avg' then
        (select round(avg((attrs->>'consumption_l_100km')::numeric), 1)
           from trips where attrs->>'consumption_l_100km' ~ '^-?[0-9]+(\.[0-9]+)?$')
      when 'diesel_week' then
        (select sum((attrs->>'liters')::numeric)
           from fuelings where attrs->>'liters' ~ '^-?[0-9]+(\.[0-9]+)?$')
      when 'active_vehicles' then
        (select count(distinct twin_id)::numeric from trips)
      -- Money (tuny/Kč) — čeká na extrakci dodacích listů/faktur; NEMĚŘENO.
      else null
    end as value
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'value', (select value from v),
      'unit_key', case (select m from p)
        when 'km_week'         then 'app.fleet.unit.km'
        when 'consumption_avg' then 'app.fleet.unit.l100km'
        when 'diesel_week'     then 'app.fleet.unit.l'
        when 'active_vehicles' then 'app.fleet.unit.vehicles'
        when 'tonnage_week'    then 'app.fleet.unit.t'
        else 'app.fleet.unit.czk'
      end,
      'state', 'ok'
    ),
    'provenance', jsonb_build_object(
      'source_slug',  case (select m from p)
                        when 'diesel_week' then 'avp-portal'
                        when 'tonnage_week' then 'money-s5'
                        when 'exported_value' then 'money-s5'
                        when 'invoiced_value' then 'money-s5'
                        else 'eurowag-telematics' end,
      'freshness_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'fleet-kpi:' || (select m from p)
    )
  );
$$;

revoke all on function public.get_fleet_kpi(jsonb) from public, anon;
grant execute on function public.get_fleet_kpi(jsonb) to authenticated, service_role;
