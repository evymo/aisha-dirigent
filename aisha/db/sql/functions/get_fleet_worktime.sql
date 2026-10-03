-- Data RPC for a 'table' block: „Dodržování jízdních dob" — driver worktime per
-- the 561/2006 tachograph, aggregated over the window. Per driver: the vehicle
-- they drove (most recent), weekly driving time (HH:MM) and a status against the
-- weekly driving limit (56 h). Reads wd_worktime (WD `_getDriverWorkTacho`,
-- seconds) joined to wd_drivers for the name.
--
-- SECURITY INVOKER → RLS on wd_* (is_admin_or_staff) fails closed. Window is
-- p_params->>'days' (default 7 — one week). Contract: (jsonb) -> jsonb
-- {data:{columns[],row_kind,rows[]}, provenance}.

create or replace function public.get_fleet_worktime(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with p as (select coalesce((p_params->>'days')::int, 7) as days),
  win as (select (now() - make_interval(days => (select days from p)))::date as since),
  agg as (
    select
      w.wd_driver_id,
      sum(coalesce(w.total_drive_seconds, 0)) as drive_s,
      (array_agg(w.car_identifikator order by w.work_date desc)
         filter (where w.car_identifikator <> ''))[1] as car
    from public.wd_worktime w
    where w.work_date >= (select since from win)
    group by w.wd_driver_id
  ),
  reg as (
    select
      a.wd_driver_id,
      nullif(trim(coalesce(d.first_name, '') || ' ' || coalesce(d.last_name, '')), '') as driver,
      a.car,
      a.drive_s,
      -- obohacení z _getStaDrivers (wd_driver_stats): služební/soukromé km + noční jízda
      s.service_km,
      s.private_km,
      s.driving_service_night_seconds as night_s
    from agg a
    left join public.wd_drivers d on d.wd_driver_id = a.wd_driver_id
    left join public.wd_driver_stats s on s.wd_driver_id = a.wd_driver_id
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'row_kind', 'driver',
      'columns', jsonb_build_array(
        jsonb_build_object('key','driver',    'label_key','app.fleet.col.driver',     'align','left'),
        jsonb_build_object('key','vehicle',   'label_key','app.fleet.col.vehicle',    'align','left'),
        jsonb_build_object('key','drive',     'label_key','app.fleet.col.driving',    'align','right'),
        jsonb_build_object('key','service_km','label_key','app.fleet.col.service_km', 'align','right'),
        jsonb_build_object('key','night',     'label_key','app.fleet.col.night',      'align','right'),
        jsonb_build_object('key','status',    'label_key','app.fleet.col.status',     'align','right')
      ),
      'rows', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id',      reg.wd_driver_id::text,
            'driver',  reg.driver,
            'vehicle', reg.car,
            -- doba řízení za okno jako HH:MM (interval > 24 h se nesmí přetočit)
            'drive',   (reg.drive_s / 3600)::int || ':' || lpad(((reg.drive_s % 3600) / 60)::int::text, 2, '0'),
            'service_km', round(reg.service_km),
            'night',   case when reg.night_s is null then null
                            else (reg.night_s / 3600)::int || ':' || lpad(((reg.night_s % 3600) / 60)::int::text, 2, '0') end,
            'status',  case when reg.drive_s > 201600 then 'over'
                            when reg.drive_s > 180000 then 'near'
                            else 'ok' end
          ) order by reg.drive_s desc
        ) from reg
      ), '[]'::jsonb)
    ),
    'provenance', jsonb_build_object(
      'source_slug',  'webdispecink-fleet',
      'freshness_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'fleet-worktime'
    )
  );
$$;

revoke all on function public.get_fleet_worktime(jsonb) from public, anon;
grant execute on function public.get_fleet_worktime(jsonb) to authenticated, service_role;
