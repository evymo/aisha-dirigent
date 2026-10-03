-- Function: public.get_production_batches_admin
-- Arguments: p_status text, p_purpose text, p_product_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:21+01:00

CREATE OR REPLACE FUNCTION public.get_production_batches_admin(p_status text DEFAULT NULL::text, p_purpose text DEFAULT NULL::text, p_product_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, batch_code text, product_id uuid, product_name text, purpose text, status text, target_quantity integer, actual_quantity integer, unit text, study_id uuid, content_type text, production_date date, expiry_date date, released_at timestamptz, qc_approved_by uuid, qc_approved_at timestamptz, qc_notes text, raw_material_lot text, supplier_info text, blockchain_tx_hash text, blockchain_recorded_at timestamptz, created_by uuid, created_at timestamptz, updated_at timestamptz, workflow_template_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;


  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'read'::public.journal_action_type,
      p_area := 'products'::public.journal_area,
      p_details := NULL,
      p_entity_id := p_product_id::text,
      p_entity_type := 'production_batch',
      p_new_values := jsonb_build_object('status', p_status),
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read production batch',
      p_tags := ARRAY['admin', 'production_batch'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    pb.id, pb.batch_code, pb.product_id, pb.product_name,
    pb.purpose::text, pb.status::text, pb.target_quantity, pb.actual_quantity,
    pb.unit, pb.study_id, pb.content_type::text, pb.production_date,
    pb.expiry_date, pb.released_at, pb.qc_approved_by, pb.qc_approved_at,
    pb.qc_notes, pb.raw_material_lot, pb.supplier_info, pb.blockchain_tx_hash,
    pb.blockchain_recorded_at, pb.created_by, pb.created_at, pb.updated_at,
    pb.workflow_template_id
  FROM public.production_batches pb
  WHERE (p_status IS NULL OR pb.status::text = p_status)
    AND (p_purpose IS NULL OR pb.purpose::text = p_purpose)
    AND (p_product_id IS NULL OR pb.product_id = p_product_id)
  ORDER BY pb.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_production_batches_admin(p_status text, p_purpose text, p_product_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_batches_admin(p_status text, p_purpose text, p_product_id uuid) TO authenticated;
