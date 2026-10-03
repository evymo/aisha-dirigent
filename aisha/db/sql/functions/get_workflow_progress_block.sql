-- ============================================================================
-- Source of Truth: get_workflow_progress_block
-- Popis: Surface blok goal_progress: aktivní procesní běhy viditelné volajícímu (ovál kontrakt: pos, milestones, goal).
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT pattern
-- Pozn.: definice = regenerát z nasazené DB (ověřeno provozním testem 07-25).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_workflow_progress_block(p_params jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_limit int := coalesce((p_params->>'limit')::int, 8);
  v_runs jsonb;
begin
  if v_uid is null and not is_service_role() then
    return jsonb_build_object('data', jsonb_build_object('runs','[]'::jsonb),
      'provenance', jsonb_build_object('source_slug','production_workflow','trace_id','wf:progress','freshness_at',now()));
  end if;
  select coalesce(jsonb_agg(run order by run->>'updated_at' desc), '[]'::jsonb) into v_runs
  from (
    select jsonb_build_object(
      'batch_id', b.id, 'story_id', b.story_id,
      'title', ps.title, 'state', prog->>'state', 'pos', (prog->>'pos')::numeric,
      'total', (prog->>'total')::int, 'completed', (prog->>'completed')::int,
      'failed', (prog->>'failed')::int,
      'milestones', prog->'steps',
      'goal', gs.last_evaluator_output,
      'updated_at', greatest(ps.last_activity_at, ps.updated_at)) as run
    from production_batches b
    join partner_stories ps on ps.id = b.story_id
    left join story_goal_state gs on gs.story_id = b.story_id
    cross join lateral (select get_batch_workflow_progress(b.id) as prog) p
    where b.story_id is not null
      and ps.status = 'active'
      and (p_params->>'batch_id' is null or b.id = (p_params->>'batch_id')::uuid)
      and (p_params->>'story_id' is null or b.story_id = (p_params->>'story_id')::uuid)
      and (prog->>'ok')::boolean   -- visibility enforced inside progress fn
    limit v_limit
  ) t;
  return jsonb_build_object(
    'data', jsonb_build_object('runs', v_runs),
    'provenance', jsonb_build_object('source_slug','production_workflow',
      'trace_id','wf:progress','freshness_at',now()));
end $function$;

REVOKE ALL ON FUNCTION public.get_workflow_progress_block(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_workflow_progress_block(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workflow_progress_block(jsonb) TO service_role;
