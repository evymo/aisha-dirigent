-- ============================================================================
-- Source of Truth: evaluate_story_process_goal
-- Popis: StoryLoop nad procesní story: milníky × success_criteria → story_goal_state; nudge JEN při změně fingerprint (goal_met / goal-correction).
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT pattern
-- Pozn.: definice = regenerát z nasazené DB (ověřeno provozním testem 07-25).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.evaluate_story_process_goal(p_story_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_criteria jsonb;
  v_per jsonb;
  v_total int; v_completed int; v_failed int;
  v_met boolean;
  v_fp text;
  v_old_fp text;
  v_out jsonb;
begin
  select project_preview->'success_criteria' into v_criteria
  from partner_stories where id = p_story_id;
  if v_criteria is null or jsonb_typeof(v_criteria) <> 'array' then
    return jsonb_build_object('ok',false,'error','story has no success criteria');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'criterion', c.name,
           'status', coalesce(s.status,'pending')) order by c.ord),'[]'::jsonb),
         count(*), count(*) filter (where s.status='completed'),
         count(*) filter (where s.status='failed')
    into v_per, v_total, v_completed, v_failed
  from jsonb_array_elements_text(v_criteria) with ordinality c(name, ord)
  left join lateral (
    select st.status from production_workflow_steps st
    join production_batches b on b.id = st.batch_id
    where b.story_id = p_story_id and st.step_name = c.name
    order by st.updated_at desc limit 1
  ) s on true;
  v_met := (v_total > 0 and v_completed = v_total);
  v_fp := md5(v_criteria::text || v_per::text);
  v_out := jsonb_build_object('met',v_met,'total',v_total,'completed',v_completed,
                              'failed',v_failed,'per_criterion',v_per);
  select fingerprint into v_old_fp from story_goal_state where story_id = p_story_id;
  insert into story_goal_state (story_id, acceptance_criteria, last_evaluated_at,
                                loop_iterations, fingerprint, last_evaluator_output)
  values (p_story_id, v_criteria, now(), 1, v_fp, v_out)
  on conflict (story_id) do update set
    acceptance_criteria = excluded.acceptance_criteria,
    last_evaluated_at = now(),
    loop_iterations = story_goal_state.loop_iterations + 1,
    fingerprint = excluded.fingerprint,
    last_evaluator_output = excluded.last_evaluator_output,
    updated_at = now();
  -- nudge only on CHANGE (no spam on repeated evaluation of the same state)
  if v_old_fp is distinct from v_fp then
    if v_met then
      insert into dirigent_nudges (story_id, event_origin, severity, message, metadata, expires_at)
      values (p_story_id, 'goal_evaluator', 'info', 'workflow.nudge.goal_met',
              v_out, now() + interval '48 hours');
    elsif v_failed > 0 then
      insert into dirigent_nudges (story_id, event_origin, severity, message, metadata, expires_at)
      values (p_story_id, 'goal_evaluator', 'goal-correction', 'workflow.nudge.goal_correction',
              v_out, now() + interval '48 hours');
    end if;
  end if;
  return jsonb_build_object('ok',true) || v_out;
end $function$;

REVOKE ALL ON FUNCTION public.evaluate_story_process_goal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.evaluate_story_process_goal(uuid) TO service_role;
