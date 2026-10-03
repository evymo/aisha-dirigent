-- Náklad podle modelu (blok typu `chart`, kind=bar).
--
-- Doktrína „fakta z PG jsou zadarmo, model jen formuluje" má smysl jen tehdy,
-- když je ten zbytek VIDĚT. Tenhle blok ukazuje, kam peníze skutečně tečou —
-- po modelech, ne jedním součtem, protože součet neřekne, který model se
-- vyplatí vyměnit.
--
-- `usd` čte z cost_json, kam ho zapisuje llm-gateway. Modely bez ceny (lokální,
-- sovereign) vyjdou v nule — a nula je tu správná odpověď, ne chybějící údaj.

create or replace function public.get_answer_chain_costs(p_params jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
SET search_path TO 'public', 'pg_temp'
as $$
declare
  v_uid    uuid := auth.uid();
  v_days   int  := least(coalesce((p_params->>'days')::int, 30), 365);
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
      'data', jsonb_build_object('kind','bar','points','[]'::jsonb),
      'provenance', jsonb_build_object('source_slug','ai_trace_events','trace_id','answer_chain:case_costs','freshness_at',now()));
  end if;

  select coalesce(jsonb_agg(p order by (p->>'value')::numeric desc), '[]'::jsonb) into v_points
  from (
    select jsonb_build_object(
      'label', model,
      -- Mikrocenty by se zaokrouhlily na nulu; 6 desetinných míst udrží rozdíl
      -- mezi „skoro zdarma" a „doopravdy nula" viditelný.
      'value', round(sum(coalesce((e.cost_json->>'usd')::numeric, 0)), 6),
      'note',  count(*)::text
    ) as p
    from (
      select coalesce(nullif(e.cost_json->>'model_id',''), e.model_id, 'neuvedeno') as model,
             e.cost_json
      from public.ai_trace_events e
      where e.created_at >= now() - make_interval(days => v_days)
        and (e.cost_json is not null or e.model_id is not null)
    ) e
    group by model
  ) t;

  return jsonb_build_object(
    'data', jsonb_build_object('kind','bar','points', v_points, 'unit_key','app.units.usd'),
    'provenance', jsonb_build_object('source_slug','ai_trace_events','trace_id','answer_chain:case_costs','freshness_at',now()));
end;
$$;

REVOKE ALL ON FUNCTION public.get_answer_chain_costs(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_answer_chain_costs(jsonb) TO authenticated, service_role;
