-- Function: public.get_production_logs_admin
-- Arguments: p_batch_id uuid, p_log_type text, p_limit integer
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:21+01:00

CREATE OR REPLACE FUNCTION public.get_production_logs_admin(p_batch_id uuid DEFAULT NULL::uuid, p_log_type text DEFAULT NULL::text, p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, batch_id uuid, batch_code text, product_name text, workflow_step_id uuid, log_type text, log_category text, title text, description text, input_volume numeric, input_concentration numeric, output_volume numeric, output_concentration numeric, loss_volume numeric, waste_volume numeric, material_lot text, source_container text, target_container text, temperature numeric, performed_by uuid, performed_by_name text, performed_at timestamptz, verified_by uuid, verified_at timestamptz, notes text, created_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF NOT is_admin_or_staff(v_user_id) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  -- Audit log for admin sensitive data access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'admin',
      p_details := jsonb_build_object('batch_id', p_batch_id, 'log_type', p_log_type, 'limit', p_limit),
      p_entity_id := NULL,
      p_entity_type := 'production_logs',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Admin viewing production logs with user info',
      p_tags := ARRAY['phi','admin','production'],
      p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT
    pl.id,
    pl.batch_id,
    pb.batch_code,
    pb.product_name,
    pl.workflow_step_id,
    pl.log_type,
    pl.log_category,
    pl.title,
    pl.description,
    pl.input_volume,
    pl.input_concentration,
    pl.output_volume,
    pl.output_concentration,
    pl.loss_volume,
    pl.waste_volume,
    pl.material_lot,
    pl.source_container,
    pl.target_container,
    pl.temperature,
    pl.performed_by,
    p.display_name,
    pl.performed_at,
    pl.verified_by,
    pl.verified_at,
    pl.notes,
    pl.created_at
  FROM production_logs pl
  LEFT JOIN production_batches pb ON pb.id = pl.batch_id
  LEFT JOIN profiles p ON p.user_id = pl.performed_by
  WHERE (p_batch_id IS NULL OR pl.batch_id = p_batch_id)
    AND (p_log_type IS NULL OR pl.log_type = p_log_type)
  ORDER BY pl.performed_at DESC
  LIMIT p_limit;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_production_logs_admin(p_batch_id uuid, p_log_type text, p_limit integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_logs_admin(p_batch_id uuid, p_log_type text, p_limit integer) TO authenticated;
