-- ============================================================================
-- Source of Truth: create_production_workflow_steps_from_template
-- Popis: Materializace uzlů (milníků) batche ze šablony. Idempotentní; celý uzel jsonb cestuje v input_data (reward, complete_on, authorized_twin_id…).
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT pattern
-- Pozn.: definice = regenerát z nasazené DB (ověřeno provozním testem 07-25).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_production_workflow_steps_from_template(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_template_id uuid;
  v_steps jsonb;
  v_existing int;
  v_created int := 0;
begin
  if not (is_admin_or_staff(auth.uid()) or is_service_role()) then
    return jsonb_build_object('ok',false,'error','admin, staff or service role required');
  end if;
  select workflow_template_id into v_template_id from production_batches where id = p_batch_id;
  if not found then
    return jsonb_build_object('ok',false,'error','batch not found');
  end if;
  if v_template_id is null then
    return jsonb_build_object('ok',false,'error','batch has no workflow template');
  end if;
  select count(*) into v_existing from production_workflow_steps where batch_id = p_batch_id;
  if v_existing > 0 then
    return jsonb_build_object('ok',true,'already_materialized',true,'steps',v_existing);
  end if;
  select coalesce(nullif(workflow_steps,'null'::jsonb), steps) into v_steps
  from production_workflow_templates where id = v_template_id;
  if v_steps is null or jsonb_typeof(v_steps) <> 'array' then
    return jsonb_build_object('ok',false,'error','template has no steps');
  end if;
  insert into production_workflow_steps
    (batch_id, step_code, step_name, step_order, description, assigned_role, assigned_user_id, status, input_data)
  select
    p_batch_id,
    s->>'step_code',
    s->>'step_name',
    coalesce((s->>'step_order')::int, ord::int),
    s->>'description',
    s->>'assigned_role',
    nullif(s->>'assigned_user_id','')::uuid,
    'pending',
    s  -- full node config travels with the step (reward, measures, …)
  from jsonb_array_elements(v_steps) with ordinality as t(s, ord);
  get diagnostics v_created = row_count;
  return jsonb_build_object('ok',true,'batch_id',p_batch_id,'created',v_created);
end $function$;

REVOKE ALL ON FUNCTION public.create_production_workflow_steps_from_template(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_production_workflow_steps_from_template(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_production_workflow_steps_from_template(uuid) TO service_role;
