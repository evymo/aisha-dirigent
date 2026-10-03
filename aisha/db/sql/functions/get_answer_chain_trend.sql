-- Vývoj zátěže odpovídacího řetězu v čase (blok typu `chart`, kind=trend).
--
-- Vrací JEDEN bod na den, i když je ten den prázdný — díra v řadě je informace
-- („tehdy se nic nedělo"), kdežto vynechaný den by graf tiše zkreslil tím, že
-- by sousední dny slepil k sobě. generate_series drží osu poctivou.
--
-- Zdroj: ai_trace_events. Když nejsou žádná data, řada vyjde v nulách — nosič
-- stojí a prázdno je signál, že si data máme vyžádat.

create or replace function public.get_answer_chain_trend(p_params jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
SET search_path TO 'public', 'pg_temp'
as $$
declare
  v_uid    uuid := auth.uid();
  v_days   int  := least(coalesce((p_params->>'days')::int, 14), 90);
  v_points jsonb;
begin
  -- ⛔ NÁROK, NE JEN PŘIHLÁŠENÍ (naměřeno 2026-09-11). Guard tu zněl
  -- `uid is null and not is_service_role()` — to ověřuje, že jsi PŘIHLÁŠENÝ,
  -- ne že na to máš nárok. Diferenciální sondou (admin × řidič bez rolí nad
  -- týmiž daty) vycházelo obojí STEJNĚ, tedy kterýkoli řidič dostal admin
  -- pohled. `SECURITY DEFINER` vypne RLS a odpovědnost tím přechází na tělo
  -- funkce; chybějící `if` tu neznamená „zamítnuto", ale plnou odpověď.
  if not (public.is_admin_or_staff() or public.is_service_role()) then
    return jsonb_build_object(
      'data', jsonb_build_object('kind','trend','points','[]'::jsonb),
      'provenance', jsonb_build_object('source_slug','ai_trace_events','trace_id','answer_chain:trend','freshness_at',now()));
  end if;

  select coalesce(jsonb_agg(p order by p->>'label'), '[]'::jsonb) into v_points
  from (
    select jsonb_build_object(
      'label', to_char(d.day, 'MM-DD'),
      'value', coalesce(c.n, 0)
    ) as p
    from generate_series(
           (now() - make_interval(days => v_days - 1))::date,
           now()::date,
           interval '1 day') as d(day)
    left join (
      select created_at::date as day, count(*) as n
      from public.ai_trace_events
      where created_at >= now() - make_interval(days => v_days)
      group by 1
    ) c on c.day = d.day
  ) t;

  return jsonb_build_object(
    'data', jsonb_build_object('kind','trend','points', v_points),
    'provenance', jsonb_build_object('source_slug','ai_trace_events','trace_id','answer_chain:trend','freshness_at',now()));
end;
$$;

REVOKE ALL ON FUNCTION public.get_answer_chain_trend(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_answer_chain_trend(jsonb) TO authenticated, service_role;
