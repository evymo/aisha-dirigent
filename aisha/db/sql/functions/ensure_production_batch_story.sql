-- ============================================================================
-- Source of Truth: ensure_production_batch_story
-- Popis: Story per procesní běh (idempotentní): partner_stories origin=process, success_criteria = milníky šablony, extends link na nadřazenou story, batch_created zápis.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT pattern
-- Pozn.: definice = regenerát z nasazené DB (ověřeno provozním testem 07-25).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ensure_production_batch_story(p_batch_id uuid, p_parent_story_id uuid DEFAULT NULL::uuid, p_title text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_batch production_batches%rowtype;
  v_steps jsonb;
  v_criteria jsonb;
  v_tpl_name text;
  v_tpl_desc text;
  v_story_id uuid;
begin
  if not (is_admin_or_staff(auth.uid()) or is_service_role()) then
    return jsonb_build_object('ok',false,'error','admin, staff or service role required');
  end if;
  select * into v_batch from production_batches where id = p_batch_id;
  if not found then
    return jsonb_build_object('ok',false,'error','batch not found');
  end if;
  if v_batch.story_id is not null then
    return jsonb_build_object('ok',true,'story_id',v_batch.story_id,'created',false);
  end if;
  select name, description, coalesce(nullif(workflow_steps,'null'::jsonb), steps)
    into v_tpl_name, v_tpl_desc, v_steps
  from production_workflow_templates where id = v_batch.workflow_template_id;
  -- milestones become the story's success criteria (goal surface for the loop)
  select coalesce(jsonb_agg(s->>'step_name' order by (s->>'step_order')::int), '[]'::jsonb)
    into v_criteria
  from jsonb_array_elements(coalesce(v_steps,'[]'::jsonb)) s;
  insert into partner_stories (user_id, title, status, priority, origin, is_stack_default, project_preview)
  values (
    auth.uid(),
    coalesce(p_title, v_batch.batch_code || ' · ' || coalesce(v_batch.product_name,'')),
    'active', 'normal', 'process', false,
    jsonb_build_object(
      'summary', coalesce(v_tpl_desc, v_tpl_name, 'Process run'),
      'goals', coalesce(to_jsonb(array[v_tpl_name]), '[]'::jsonb),
      'constraints', '[]'::jsonb,
      'success_criteria', v_criteria)
  ) returning id into v_story_id;
  update production_batches set story_id = v_story_id where id = p_batch_id;
  if p_parent_story_id is not null then
    insert into story_links (source_story_id, target_story_id, link_type, link_direction,
                             created_by, created_by_agent, is_accepted, metadata)
    values (v_story_id, p_parent_story_id, 'extends', 'forward',
            auth.uid(), 'workflow', true,
            jsonb_build_object('origin','process','batch_id',p_batch_id));
  end if;
  perform add_story_system_entry(
    v_story_id, 'tracking_event', 'workflow.timeline.batch_created',
    jsonb_build_object('batch_id',p_batch_id,'batch_code',v_batch.batch_code,
                       'template_id',v_batch.workflow_template_id,'template_name',v_tpl_name),
    now(), 'production_batches', p_batch_id);
  return jsonb_build_object('ok',true,'story_id',v_story_id,'created',true);
end $function$;

REVOKE ALL ON FUNCTION public.ensure_production_batch_story(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_production_batch_story(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_production_batch_story(uuid,uuid,text) TO service_role;
