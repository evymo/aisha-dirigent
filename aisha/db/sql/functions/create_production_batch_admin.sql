-- Function: public.create_production_batch_admin
-- Arguments: p_batch_code text, p_product_id uuid, p_product_name text, p_purpose text, p_target_quantity integer, p_unit text, p_study_id uuid, p_content_type text, p_production_date date, p_expiry_date date, p_raw_material_lot text, p_workflow_template_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:10+01:00

CREATE OR REPLACE FUNCTION public.create_production_batch_admin(p_batch_code text, p_product_id uuid, p_product_name text, p_purpose text, p_target_quantity integer, p_unit text DEFAULT 'vials'::text, p_study_id uuid DEFAULT NULL::uuid, p_content_type text DEFAULT NULL::text, p_production_date date DEFAULT NULL::date, p_expiry_date date DEFAULT NULL::date, p_raw_material_lot text DEFAULT NULL::text, p_workflow_template_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_batch_id uuid;
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  INSERT INTO production_batches (
    batch_code, product_id, product_name, purpose, target_quantity,
    unit, study_id, content_type, production_date, expiry_date,
    raw_material_lot, workflow_template_id, created_by
  ) VALUES (
    p_batch_code, p_product_id, p_product_name, p_purpose::batch_purpose,
    p_target_quantity, p_unit, p_study_id, 
    CASE WHEN p_content_type IS NOT NULL THEN p_content_type::vial_content_type ELSE NULL END,
    p_production_date, p_expiry_date, p_raw_material_lot, p_workflow_template_id, auth.uid()
  )
  RETURNING id INTO v_batch_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'create'::journal_action_type,
      p_area := 'production'::journal_area,
      p_entity_id := v_batch_id::text,
      p_entity_type := 'production_batch',
      p_severity := 'info'::journal_severity,
      p_summary := format('Created production batch %s', p_batch_code),
    p_user_id := auth.uid()
  );

  RETURN v_batch_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_production_batch_admin(p_batch_code text, p_product_id uuid, p_product_name text, p_purpose text, p_target_quantity integer, p_unit text, p_study_id uuid, p_content_type text, p_production_date date, p_expiry_date date, p_raw_material_lot text, p_workflow_template_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_production_batch_admin(p_batch_code text, p_product_id uuid, p_product_name text, p_purpose text, p_target_quantity integer, p_unit text, p_study_id uuid, p_content_type text, p_production_date date, p_expiry_date date, p_raw_material_lot text, p_workflow_template_id uuid) TO authenticated;
