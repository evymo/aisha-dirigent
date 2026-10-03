-- ============================================================================
-- Source of Truth: get_workflow_timeline_block
-- Popis: Surface blok table: narace procesních stories, nejnovější nahoře.
--        p_params: story_id (volitelné), limit (výchozí 50, strop 500).
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT pattern
-- Pozn.: definice = regenerát z nasazené DB (ověřeno provozním testem 07-25).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_workflow_timeline_block(p_params jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_limit int := least(greatest(coalesce(nullif(p_params->>'limit', '')::int, 50), 1), 500);
  -- ⛔ NÁROK JAKO MNOŽINY, JEDNOU ZA VOLÁNÍ (naměřeno 2026-09-29 na produkci).
  -- Dřív tu stálo `is_service_role() or is_admin_or_staff(v_uid) or exists(…
  -- workflow_step_visible_to(v_uid, …))` — predikát (SECURITY DEFINER, plpgsql,
  -- dynamické SQL) se pro běžného uživatele volal pro KAŽDÝ krok každého běhu:
  -- člen bez role 92–95 s pro 0 řádků, a funkci smí přímo přes /rpc volat
  -- kdokoli přihlášený = DoS páka. Admin platil 1,7 s: obě pomocné funkce po
  -- řádcích a EXISTS pod OR, který planner ocenil po řádcích (odhad 119 mil.
  -- → JIT). Vzor je týž jako CTE `scope` ve frontě kroků a ve věži (07-30 V3):
  -- ramena 1:1 s predikátem při volání bez rozsahu a bez kódu kroku —
  -- přiřazení · role · potvrzená vazba účtu na `authorized_twin_id`.
  v_all boolean := public.is_service_role() or public.is_admin_or_staff(v_uid);
  v_roles text[] := '{}';
  v_twins text[] := '{}';
  v_rows jsonb;
begin
  if not v_all then
    select coalesce(array_agg(ur.role::text), '{}')
      into v_roles
      from public.user_roles ur
     where ur.user_id = v_uid;
    select coalesce(array_agg(r.twin_id::text), '{}')
      into v_twins
      from public.twin_external_refs r
     where r.ref_kind = 'account'
       and r.source_key = v_uid::text
       and r.state = 'confirmed' and r.valid_from <= now()
       and (r.valid_to is null or r.valid_to > now());
  end if;

  -- ⛔ LIMIT PŘED AGREGACÍ (naměřeno 2026-09-23 na produkci): `limit` stál za
  -- `jsonb_agg`, tedy omezoval JEDEN výsledný řádek agregátu, ne záznamy. Blok
  -- `wf_timeline` v poradě vydával všech 41 193 záznamů = 7 MB a 4,9 s při
  -- každém otevření sekce — a shell ho pak stejně zahodil (viz sloupce níž).
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id,
           'when', to_char(v.occurred_at, 'DD.MM HH24:MI'),
           'run', v.run,
           'milestone', v.milestone,
           'event', v.event) order by v.occurred_at desc, v.id), '[]'::jsonb)
    into v_rows
  from (
    select se.id, se.occurred_at, ps.title as run,
           coalesce(se.metadata->>'step_name', se.metadata->>'step_code', '—') as milestone,
           se.content as event
    from story_entries se
    join partner_stories ps on ps.id = se.story_id
    where ps.origin = 'process'
      and (p_params->>'story_id' is null or se.story_id = (p_params->>'story_id')::uuid)
      -- Nekorelovaný `IN`, ne `EXISTS` pod OR: ten planner ocení z alternativy
      -- „po řádcích" (costsize.c: „Arbitrarily use the first alternative plan
      -- for costing"), i když za běhu použije hashovanou — odhad pak lže a JIT
      -- kompiluje zbytečně. `IN` má jedinou variantu a cenu jednou.
      and (v_all or se.story_id in (
            select b.story_id
              from production_batches b
              join production_workflow_steps s on s.batch_id = b.id
             where s.assigned_user_id = v_uid
                or s.assigned_role = any(v_roles)
                or (s.input_data->>'authorized_twin_id') = any(v_twins)))
    order by se.occurred_at desc, se.id
    limit v_limit
  ) v;
  return jsonb_build_object(
    'data', jsonb_build_object(
      -- `label_key`, ne hotový `label`: kontrakt tabulky hotový text v hlavičce
      -- nepřipouští (extranet běží v šesti jazycích) a blok s `label` shell
      -- ZAHODIL celý. Dřívější `labels` ze source_params se už nečtou —
      -- znění nese tabulka překladů.
      'columns', jsonb_build_array(
        jsonb_build_object('key','when','label_key','app.wf.col.when'),
        jsonb_build_object('key','run','label_key','app.wf.col.run'),
        jsonb_build_object('key','milestone','label_key','app.wf.col.milestone'),
        jsonb_build_object('key','event','label_key','app.wf.col.event')),
      -- `id` je záznam story (`story_entries.id`), ne doklad.
      'row_kind', 'story_entry',
      'rows', v_rows),
    'provenance', jsonb_build_object('source_slug','production_workflow',
      'trace_id','wf:timeline','freshness_at',now()));
end $function$;

REVOKE ALL ON FUNCTION public.get_workflow_timeline_block(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_workflow_timeline_block(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workflow_timeline_block(jsonb) TO service_role;
