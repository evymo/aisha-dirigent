-- Function: public.get_production_workflow_templates_admin
-- Arguments: p_product_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:24+01:00

CREATE OR REPLACE FUNCTION public.get_production_workflow_templates_admin(p_product_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, name text, description text, product_id uuid, is_default boolean, workflow_data jsonb, workflow_steps jsonb, created_at timestamptz, product jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'view'::journal_action_type,
      p_area := 'production'::journal_area,
      p_entity_id := COALESCE(p_product_id::text, 'all'),
      p_entity_type := 'production_workflow_templates',
      p_severity := 'info'::journal_severity,
      p_summary := 'Viewed production workflow templates',
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    pwt.id,
    pwt.name,
    pwt.description,
    pwt.product_id,
    pwt.is_default,
    pwt.workflow_data,
    pwt.workflow_steps,
    pwt.created_at,
    CASE
      WHEN p.id IS NULL THEN NULL
      ELSE jsonb_build_object('name', p.name)
    END AS product
  FROM production_workflow_templates pwt
  LEFT JOIN products p ON p.id = pwt.product_id
  WHERE (p_product_id IS NULL OR pwt.product_id = p_product_id)
  ORDER BY pwt.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_production_workflow_templates_admin(p_product_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_workflow_templates_admin(p_product_id uuid) TO authenticated;
