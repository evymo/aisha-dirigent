-- Function: public.upsert_production_supplier_admin
-- Creates or updates a production supplier
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.upsert_production_supplier_admin(
  p_approved_by uuid DEFAULT NULL,
  p_certificates jsonb DEFAULT '[]'::jsonb,
  p_contacts jsonb DEFAULT '{}'::jsonb,
  p_country text DEFAULT NULL,
  p_id uuid DEFAULT NULL,
  p_is_active boolean DEFAULT true,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_notes text DEFAULT NULL,
  p_qualification_status text DEFAULT 'pending',
  p_risk_level text DEFAULT 'medium',
  p_supplier_code text DEFAULT NULL,
  p_supplier_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result_id uuid;
  v_action text;
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  IF p_supplier_code IS NULL OR p_supplier_name IS NULL THEN
    RAISE EXCEPTION 'supplier_code and supplier_name are required';
  END IF;

  IF p_id IS NOT NULL THEN
    v_action := 'update';
    UPDATE public.production_suppliers SET
      supplier_code = p_supplier_code,
      supplier_name = p_supplier_name,
      country = p_country,
      contacts = p_contacts,
      qualification_status = p_qualification_status,
      approved_by = p_approved_by,
      approved_at = CASE WHEN p_qualification_status = 'qualified' AND qualification_status != 'qualified' THEN now() ELSE approved_at END,
      risk_level = p_risk_level,
      certificates = p_certificates,
      is_active = p_is_active,
      notes = p_notes,
      metadata = p_metadata,
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_result_id;
  ELSE
    v_action := 'create';
    INSERT INTO public.production_suppliers (
      supplier_code, supplier_name, country, contacts,
      qualification_status, approved_by, risk_level, certificates,
      is_active, notes, metadata, created_by
    ) VALUES (
      p_supplier_code, p_supplier_name, p_country, p_contacts,
      p_qualification_status, p_approved_by, p_risk_level, p_certificates,
      p_is_active, p_notes, p_metadata, auth.uid()
    )
    RETURNING id INTO v_result_id;
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := v_action::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := v_result_id::text,
    p_entity_type := 'production_supplier',
    p_new_values := jsonb_build_object('supplier_code', p_supplier_code, 'qualification_status', p_qualification_status),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := format('Admin %s production supplier %s', v_action, p_supplier_code),
    p_tags := ARRAY['admin', 'production_supplier'],
    p_user_id := auth.uid()
  );

  RETURN v_result_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_production_supplier_admin(uuid, jsonb, jsonb, text, uuid, boolean, jsonb, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_production_supplier_admin(uuid, jsonb, jsonb, text, uuid, boolean, jsonb, text, text, text, text, text) TO authenticated;
