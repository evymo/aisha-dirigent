-- Function: public.create_production_workflow_template_admin
-- Arguments: p_description text, p_name text, p_product_id uuid, p_workflow_data jsonb, p_workflow_steps jsonb
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:10+01:00

DROP FUNCTION IF EXISTS public.create_production_workflow_template_admin(text, uuid, text, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.create_production_workflow_template_admin(p_description text DEFAULT NULL::text, p_name text DEFAULT NULL::text, p_product_id uuid DEFAULT NULL::uuid, p_workflow_data jsonb DEFAULT NULL::jsonb, p_workflow_steps jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  INSERT INTO production_workflow_templates (
    name,
    product_id,
    description,
    version,
    workflow_data,
    workflow_steps,
    is_default
  ) VALUES (
    p_name,
    p_product_id,
    p_description,
    '1.0',
    COALESCE(p_workflow_data, jsonb_build_object('nodes', '[]'::jsonb, 'edges', '[]'::jsonb)),
    COALESCE(p_workflow_steps, '[]'::jsonb),
    false
  )
  RETURNING id INTO v_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'create'::journal_action_type,
      p_area := 'production'::journal_area,
      p_entity_id := v_id::text,
      p_entity_type := 'production_workflow_template',
      p_severity := 'info'::journal_severity,
      p_summary := 'Created production workflow template',
    p_user_id := auth.uid()
  );

  RETURN v_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_production_workflow_template_admin(p_description text, p_name text, p_product_id uuid, p_workflow_data jsonb, p_workflow_steps jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_production_workflow_template_admin(p_description text, p_name text, p_product_id uuid, p_workflow_data jsonb, p_workflow_steps jsonb) TO authenticated;
