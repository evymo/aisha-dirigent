-- Poslední běhy (admin pohled) — co systém dělal sám od sebe a jak to dopadlo.
--
-- Zdroj ai_runs: každý běh patří ke story (axiom „běh vždy patří ke story"),
-- takže se sem dostane i vnitřní běh přes stack-default story. `kind` je nosič
-- druhu běhu — proactive, ide_session, … — a NErozšiřuje se o další tabulku
-- *_runs, ať se ten anti-vzor neopakuje.
--
-- Prázdný výsledek je legitimní stav čerstvé instance, ne chyba.

create or replace function public.get_answer_chain_runs(p_params jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
SET search_path TO 'public', 'pg_temp'
as $$
declare
  v_uid   uuid := auth.uid();
  v_limit int  := least(coalesce((p_params->>'limit')::int, 20), 200);
  v_rows  jsonb;
  -- Sloupce jsou KONTRAKT bloku, ne data — viz get_answer_chain_metrics.
  v_cols jsonb := jsonb_build_array(
    jsonb_build_object('key','started','label_key','app.cols.started'),
    jsonb_build_object('key','kind',   'label_key','app.cols.kind'),
    jsonb_build_object('key','status', 'label_key','app.cols.status'),
    jsonb_build_object('key','steps',  'label_key','app.cols.steps','align','right'));
begin
  -- ⛔ NÁROK, NE JEN PŘIHLÁŠENÍ (naměřeno 2026-09-11). Guard tu zněl
  -- `uid is null and not is_service_role()` — to ověřuje, že jsi PŘIHLÁŠENÝ,
  -- ne že na to máš nárok. Diferenciální sondou (admin × řidič bez rolí nad
  -- týmiž daty) vycházelo obojí STEJNĚ, tedy kterýkoli řidič dostal admin
  -- pohled. `SECURITY DEFINER` vypne RLS a odpovědnost tím přechází na tělo
  -- funkce; chybějící `if` tu neznamená „zamítnuto", ale plnou odpověď.
  if not (public.is_admin_or_staff() or public.is_service_role()) then
    -- Odmítnutí vydá TÝŽ kontrakt s NULOU řádků (viz get_answer_chain_metrics):
    -- tabulka bez sloupců maskou neprojde a povrch blok zahodí.
    return jsonb_build_object(
      'data', jsonb_build_object('columns', v_cols, 'row_kind', 'answer_run', 'rows', '[]'::jsonb),
      'provenance', jsonb_build_object('source_slug','ai_runs','trace_id','answer_chain:test_run','freshness_at',now()));
  end if;

  select coalesce(jsonb_agg(r order by r->>'started' desc), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id',      left(a.id::text, 8),
      'kind',    a.kind,
      'status',  a.status,
      'started', to_char(a.started_at, 'YYYY-MM-DD HH24:MI'),
      -- Kroky běhu jsou v ai_trace_events; jejich počet říká, jestli běh
      -- doopravdy něco dělal, nebo jen vznikl a zhasl.
      'steps',   (select count(*) from public.ai_trace_events e where e.run_id = a.id)
    ) as r
    from public.ai_runs a
    order by a.started_at desc nulls last
    limit v_limit
  ) t;

  return jsonb_build_object(
    'data', jsonb_build_object(
      'columns', v_cols,
      -- `id` je ZKRÁCENÝ běh (left(...,8)) — zobrazovací hodnota, kterou
      -- nelze ničím otevřít. Druh se přesto říká: shell pak řekne „tenhle
      -- řádek nemá detail" místo aby poslal zkomolené id čtečce dokladů
      -- a vydal prázdnou kartu.
      'row_kind', 'answer_run',
      'rows', v_rows),
    'provenance', jsonb_build_object('source_slug','ai_runs','trace_id','answer_chain:test_run','freshness_at',now()));
end;
$$;

REVOKE ALL ON FUNCTION public.get_answer_chain_runs(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_answer_chain_runs(jsonb) TO authenticated, service_role;
