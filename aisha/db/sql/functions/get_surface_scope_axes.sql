-- OSY POHLEDU PRO SEKCI — deklarace z dat, volby odvozené z dat.
--
-- Klient se ptá JEDNOU na sekci a dostane hotový přepínač: které osy smí použít
-- (řádky `surface_scope_axes`, které mu RLS pustí) a jaké volby na nich reálně
-- existují (`get_scope_options` nad deklarovaným substrátem). Dřív měl klient
-- osy v konstantě a volal options per osa — seznam os tím byl v KÓDU a nesl
-- jména věcí jedné instance (naměřeno 2026-09-06, viz surface_scope_axes).
--
-- ⭐ Osa bez jediné volby se NEVYDÁ. Přepínač, který nabízí prázdnou osu, lže
-- o tom, že je čím filtrovat; a instance, která osu deklaruje „do zásoby",
-- nemá mít poloprázdnou lištu, dokud data nedorostou.
--
-- SECURITY INVOKER dvakrát: RLS rozhoduje, které OSY volající vidí, a táž
-- pravidla platí uvnitř `get_scope_options` pro VOLBY. Nikde se neobchází.
--
-- Konfigurace (p_params):
--   surface : sekce, pro kterou se osy ptají (povinné; osa s prázdným
--             `surfaces` platí pro všechny sekce)
--   limit   : kolik voleb na osu (default 50, strop 200) — postoupí dál
--
-- Kontrakt: (jsonb) -> jsonb
--   {data:{surface, axes:[{axis_key,title_key,dim,options:[{value,count}]}]},
--    provenance}

create or replace function public.get_surface_scope_axes(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with cfg as (
    select
      nullif(btrim(coalesce(p_params->>'surface', '')), '')            as sekce,
      least(coalesce(nullif(p_params->>'limit', '')::int, 50), 200)    as lim
  ),
  -- ⛔ MATERIALIZED = optimalizační plot, ne kosmetika (naměřeno 2026-09-29
  -- na produkci). Bez něj planner CTE vložil do dotazu, filtr
  -- `jsonb_array_length(options) > 0` z `s_volbami` sjel do skenu os a
  -- podmínka „osa patří sekci" zůstala jako Join Filter NAD ním — drahé
  -- `get_scope_options` (sken registru, ~0,9 s) se tak spočítalo i pro sekci,
  -- kde osa vůbec není, a pak se zahodilo. Sekce bez osy 807–939 → 1–2 ms,
  -- výstup md5 shodný. Druhý `materialized` na `s_volbami` nepomůže (změřeno).
  osy as materialized (
    select a.axis_key, a.title_key, a.dim, a.params, a.position
    from public.surface_scope_axes a, cfg
    where a.is_active
      and (jsonb_array_length(a.surfaces) = 0
           or (cfg.sekce is not null and a.surfaces ? cfg.sekce))
  ),
  s_volbami as (
    select o.axis_key, o.title_key, o.dim, o.position,
           coalesce(
             public.get_scope_options(o.params || jsonb_build_object('limit', (select lim from cfg)))
               ->'data'->'options',
             '[]'::jsonb) as options
    from osy o
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'surface', (select sekce from cfg),
      'axes', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'axis_key',  v.axis_key,
                 'title_key', v.title_key,
                 'dim',       v.dim,
                 'options',   v.options)
               order by v.position, v.axis_key)
        from s_volbami v
        where jsonb_array_length(v.options) > 0), '[]'::jsonb)
    ),
    'provenance', jsonb_build_object(
      'source_slug',  'surface_scope_axes',
      'freshness_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'scope-axes:' || coalesce((select sekce from cfg), '-')
    )
  );
$$;

comment on function public.get_surface_scope_axes(jsonb) is
  'Declared view axes for one surface section, each with options derived from data. Axes are rows in surface_scope_axes (instance overlay); SECURITY INVOKER so RLS decides both which axes and which options the caller sees. An axis with no options is not returned.';

revoke all on function public.get_surface_scope_axes(jsonb) from public, anon;
grant execute on function public.get_surface_scope_axes(jsonb) to authenticated, service_role;
