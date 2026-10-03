-- Provozní metriky odpovídacího řetězu (admin pohled).
--
-- Nosič se staví i tam, kde hodnoty zatím nejsou: prázdný blok s provenancí je
-- SIGNÁL, že si data máme vyžádat, ne důvod blok nepostavit. Proto tu není
-- žádná podmínka „vrať null když je málo řádků" — vrátí se, co je.
--
-- Zdroj: ai_trace_events (jeden řádek na krok běhu — router, kompozice, nástroj).

create or replace function public.get_answer_chain_metrics(p_params jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
SET search_path TO 'public', 'pg_temp'
as $$
declare
  v_uid  uuid := auth.uid();
  v_days int  := least(coalesce((p_params->>'days')::int, 30), 365);
  v_rows jsonb;
  -- Sloupce jsou KONTRAKT bloku (která maska, jaké popisky), ne data. Drží se
  -- v proměnné, aby odmítavá i plná větev vydaly TÝŽ tvar a nemohly se rozejít.
  v_cols jsonb := jsonb_build_array(
    jsonb_build_object('key','kind',   'label_key','app.cols.kind'),
    jsonb_build_object('key','calls',  'label_key','app.cols.calls',  'align','right'),
    jsonb_build_object('key','ok',     'label_key','app.cols.ok',     'align','right'),
    jsonb_build_object('key','errors', 'label_key','app.cols.errors', 'align','right'),
    jsonb_build_object('key','p50_ms', 'label_key','app.cols.p50',    'align','right'),
    jsonb_build_object('key','p95_ms', 'label_key','app.cols.p95',    'align','right'));
begin
  -- ⛔ NÁROK, NE JEN PŘIHLÁŠENÍ (naměřeno 2026-09-11). Guard tu zněl
  -- `uid is null and not is_service_role()` — to ověřuje, že jsi PŘIHLÁŠENÝ,
  -- ne že na to máš nárok. Diferenciální sondou (admin × řidič bez rolí nad
  -- týmiž daty) vycházelo obojí STEJNĚ, tedy kterýkoli řidič dostal admin
  -- pohled. `SECURITY DEFINER` vypne RLS a odpovědnost tím přechází na tělo
  -- funkce; chybějící `if` tu neznamená „zamítnuto", ale plnou odpověď.
  if not (public.is_admin_or_staff() or public.is_service_role()) then
    -- Odmítnutí vydá TÝŽ kontrakt s NULOU řádků, ne `columns: []`. Dva důvody:
    -- (1) tabulka bez sloupců neprojde maskou, povrch ji zahodí a uživatel místo
    --     prázdné tabulky nevidí blok vůbec (brána kontraktu bloků 2026-09-12);
    -- (2) odmítnutí tím vypadá stejně jako prázdná instance — nevzniká orákulum,
    --     které by nepovolanému prozradilo, že tu NĚCO je, jen ne pro něj.
    return jsonb_build_object(
      'data', jsonb_build_object('columns', v_cols, 'rows', '[]'::jsonb),
      'provenance', jsonb_build_object('source_slug','ai_trace_events','trace_id','answer_chain:metrics','freshness_at',now()));
  end if;

  select coalesce(jsonb_agg(r order by r->>'kind'), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'kind',      e.event_type,
      'calls',     count(*),
      'ok',        count(*) filter (where e.status = 'ok'),
      'errors',    count(*) filter (where e.status is distinct from 'ok'),
      -- Medián, ne průměr: jeden pomalý běh nesmí posunout obrázek o zdraví.
      'p50_ms',    percentile_disc(0.5) within group (order by e.duration_ms),
      'p95_ms',    percentile_disc(0.95) within group (order by e.duration_ms)
    ) as r
    from public.ai_trace_events e
    where e.created_at >= now() - make_interval(days => v_days)
    group by e.event_type
  ) t;

  return jsonb_build_object(
    'data', jsonb_build_object(
      'columns', v_cols,
      'rows', v_rows),
    'provenance', jsonb_build_object('source_slug','ai_trace_events','trace_id','answer_chain:metrics','freshness_at',now()));
end;
$$;

REVOKE ALL ON FUNCTION public.get_answer_chain_metrics(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_answer_chain_metrics(jsonb) TO authenticated, service_role;
