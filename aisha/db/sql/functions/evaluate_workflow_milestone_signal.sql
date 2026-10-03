-- ============================================================================
-- Source of Truth: evaluate_workflow_milestone_signal
-- Popis: Milník dosažený SIGNÁLEM po nativní integration_events sběrnici. Kritéria = DATA na uzlu (complete_on: event_type + match containment). Bez odměny (signál nemá lidského příjemce). Goal re-evaluace.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT pattern
-- Pozn.: definice = regenerát z nasazené DB (ověřeno provozním testem 07-25).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.evaluate_workflow_milestone_signal(p_event_id uuid, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ev integration_events%rowtype;
  v_step record;
  v_done jsonb := '[]'::jsonb;
  v_n int := 0;
begin
  if not (is_admin_or_staff(auth.uid()) or is_service_role()) then
    return jsonb_build_object('ok',false,'error','admin, staff or service role required');
  end if;
  select * into v_ev from integration_events where id = p_event_id;
  if not found then
    return jsonb_build_object('ok',false,'error','integration event not found');
  end if;
  if v_ev.story_id is null then
    return jsonb_build_object('ok',false,'error','event has no story routing');
  end if;
  for v_step in
    select s.* from production_workflow_steps s
    join production_batches b on b.id = s.batch_id
    where b.story_id = v_ev.story_id
      and s.status in ('pending','in_progress')
      and s.input_data ? 'complete_on'
      and s.input_data->'complete_on'->>'event_type' = v_ev.event_type
      and (not (s.input_data->'complete_on' ? 'match')
           or p_payload @> (s.input_data->'complete_on'->'match'))
    order by s.step_order
    for update of s
  loop
    update production_workflow_steps set
      status = 'completed', completed_by = null, completed_at = now(),
      output_data = jsonb_build_object('signal_event_id',p_event_id,
                                       'event_source',v_ev.event_source,
                                       'event_type',v_ev.event_type,
                                       'payload',p_payload),
      notes = 'signal-completed', updated_at = now()
    where id = v_step.id;
    perform add_story_system_entry(
      v_ev.story_id, 'tracking_event', 'workflow.timeline.milestone_signal',
      jsonb_build_object('step_code',v_step.step_code,'step_name',v_step.step_name,
                         'step_order',v_step.step_order,'batch_id',v_step.batch_id,
                         'event_source',v_ev.event_source,'event_type',v_ev.event_type,
                         'signal_event_id',p_event_id),
      now(), 'production_workflow_steps', v_step.id);
    v_done := v_done || jsonb_build_object('step_id',v_step.id,'step_code',v_step.step_code);
    v_n := v_n + 1;
  end loop;
  update integration_events
    set metadata = coalesce(metadata,'{}'::jsonb)
        || jsonb_build_object('payload',p_payload,'workflow_completed_steps',v_n)
  where id = p_event_id;
  perform complete_integration_event(p_event_id, 'completed', null, null);
  if v_n > 0 then
    begin
      perform evaluate_story_process_goal(v_ev.story_id);
        exception when others then
      -- goal re-evaluation is a side effect and must never roll back the
      -- operational fact — but the failure is LOGGED, never swallowed
      insert into audit_journal (user_id, action, metadata)
      values (auth.uid(), 'workflow.goal_evaluation_failed',
              jsonb_build_object('error', SQLERRM));
    end;
  end if;
  return jsonb_build_object('ok',true,'completed_count',v_n,'completed_steps',v_done);
end $function$;

REVOKE ALL ON FUNCTION public.evaluate_workflow_milestone_signal(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.evaluate_workflow_milestone_signal(uuid,jsonb) TO service_role;
