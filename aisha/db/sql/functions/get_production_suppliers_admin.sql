-- Function: public.get_production_suppliers_admin
-- Returns production suppliers (master data)
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.get_production_suppliers_admin(
  p_qualification_status text DEFAULT NULL,
  p_risk_level text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  supplier_code text,
  supplier_name text,
  country text,
  contacts jsonb,
  qualification_status text,
  approved_at timestamptz,
  approved_by uuid,
  risk_level text,
  certificates jsonb,
  audit_history jsonb,
  is_active boolean,
  notes text,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  created_by uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := 'read'::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := NULL,
    p_entity_type := 'production_supplier',
    p_new_values := jsonb_build_object('qualification_status', p_qualification_status, 'risk_level', p_risk_level),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin read production suppliers',
    p_tags := ARRAY['admin', 'production_supplier'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    ps.id, ps.supplier_code, ps.supplier_name, ps.country,
    ps.contacts, ps.qualification_status, ps.approved_at, ps.approved_by,
    ps.risk_level, ps.certificates, ps.audit_history, ps.is_active,
    ps.notes, ps.metadata, ps.created_at, ps.updated_at, ps.created_by
  FROM public.production_suppliers ps
  WHERE (p_qualification_status IS NULL OR ps.qualification_status = p_qualification_status)
    AND (p_risk_level IS NULL OR ps.risk_level = p_risk_level)
  ORDER BY ps.supplier_code;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_suppliers_admin(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_suppliers_admin(text, text) TO authenticated;
