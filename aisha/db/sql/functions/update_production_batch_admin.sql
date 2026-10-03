-- Function: public.update_production_batch_admin
-- Arguments: p_batch_id uuid, p_status text, p_actual_quantity integer, p_qc_notes text, p_released_at timestamp with time zone
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:24+01:00

CREATE OR REPLACE FUNCTION public.update_production_batch_admin(p_batch_id uuid, p_status text DEFAULT NULL::text, p_actual_quantity integer DEFAULT NULL::integer, p_qc_notes text DEFAULT NULL::text, p_released_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old_status text;
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  SELECT status::text INTO v_old_status FROM production_batches WHERE id = p_batch_id;

  UPDATE production_batches SET
    status = COALESCE(p_status::batch_status, status),
    actual_quantity = COALESCE(p_actual_quantity, actual_quantity),
    qc_notes = COALESCE(p_qc_notes, qc_notes),
    released_at = COALESCE(p_released_at, released_at),
    qc_approved_by = CASE WHEN p_status = 'released' THEN auth.uid() ELSE qc_approved_by END,
    qc_approved_at = CASE WHEN p_status = 'released' THEN now() ELSE qc_approved_at END,
    updated_at = now()
  WHERE id = p_batch_id;

  IF p_status IS NOT NULL AND p_status != v_old_status THEN
    PERFORM public.write_audit_journal(
        p_action_type := 'update'::journal_action_type,
        p_area := 'production'::journal_area,
        p_entity_id := p_batch_id::text,
        p_entity_type := 'production_batch',
        p_severity := 'info'::journal_severity,
        p_summary := format('Updated batch status from %s to %s', v_old_status, p_status),
    p_user_id := auth.uid()
  );
  END IF;

  RETURN true;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_production_batch_admin(p_batch_id uuid, p_status text, p_actual_quantity integer, p_qc_notes text, p_released_at timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_production_batch_admin(p_batch_id uuid, p_status text, p_actual_quantity integer, p_qc_notes text, p_released_at timestamp with time zone) TO authenticated;
