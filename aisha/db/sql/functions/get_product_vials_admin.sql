-- Function: public.get_product_vials_admin
-- Arguments: p_batch_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:21+01:00

CREATE OR REPLACE FUNCTION public.get_product_vials_admin(p_batch_id uuid)
 RETURNS TABLE(id uuid, batch_id uuid, vial_code text, content_type text, status text, assigned_study_id uuid, manufactured_at timestamptz, dispensed_at timestamptz, qr_code_url text, created_at timestamptz, updated_at timestamptz)
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
      p_entity_id := p_batch_id::text,
      p_entity_type := 'product_vials',
      p_severity := 'info'::journal_severity,
      p_summary := 'Viewed product vials',
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    pv.id,
    pv.batch_id,
    pv.vial_code,
    pv.content_type::text,
    pv.status::text,
    pv.assigned_study_id,
    pv.manufactured_at,
    pv.dispensed_at,
    pv.qr_code_url,
    pv.created_at,
    pv.updated_at
  FROM product_vials pv
  WHERE pv.batch_id = p_batch_id
  ORDER BY pv.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_product_vials_admin(p_batch_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_vials_admin(p_batch_id uuid) TO authenticated;
