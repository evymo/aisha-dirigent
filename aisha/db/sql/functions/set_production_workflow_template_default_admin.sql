-- Function: public.set_production_workflow_template_default_admin
-- Arguments: p_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:05+01:00

CREATE OR REPLACE FUNCTION public.set_production_workflow_template_default_admin(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product_id uuid;
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  SELECT product_id INTO v_product_id
  FROM production_workflow_templates
  WHERE id = p_id;

  IF v_product_id IS NOT NULL THEN
    UPDATE production_workflow_templates
    SET is_default = false
    WHERE product_id = v_product_id;
  END IF;

  UPDATE production_workflow_templates
  SET is_default = true
  WHERE id = p_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'update'::journal_action_type,
      p_area := 'production'::journal_area,
      p_entity_id := p_id::text,
      p_entity_type := 'production_workflow_template',
      p_severity := 'info'::journal_severity,
      p_summary := 'Set production workflow template as default',
    p_user_id := auth.uid()
  );

  RETURN true;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.set_production_workflow_template_default_admin(p_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_production_workflow_template_default_admin(p_id uuid) TO authenticated;
