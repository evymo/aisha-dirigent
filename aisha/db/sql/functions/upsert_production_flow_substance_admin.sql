-- Function: public.upsert_production_flow_substance_admin
-- Creates or updates a production flow substance
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.upsert_production_flow_substance_admin(
  p_cas_number text DEFAULT NULL,
  p_default_concentration_pct numeric DEFAULT 100,
  p_default_unit text DEFAULT 'l',
  p_density_kg_l numeric DEFAULT NULL,
  p_id uuid DEFAULT NULL,
  p_is_active boolean DEFAULT true,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_notes text DEFAULT NULL,
  p_regulatory_class text DEFAULT NULL,
  p_substance_code text DEFAULT NULL,
  p_substance_name text DEFAULT NULL
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

  IF p_substance_code IS NULL OR p_substance_name IS NULL THEN
    RAISE EXCEPTION 'substance_code and substance_name are required';
  END IF;

  IF p_id IS NOT NULL THEN
    v_action := 'update';
    UPDATE public.production_flow_substances SET
      substance_code = p_substance_code,
      substance_name = p_substance_name,
      cas_number = p_cas_number,
      density_kg_l = p_density_kg_l,
      regulatory_class = p_regulatory_class,
      default_unit = p_default_unit,
      default_concentration_pct = p_default_concentration_pct,
      is_active = p_is_active,
      notes = p_notes,
      metadata = p_metadata,
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_result_id;
  ELSE
    v_action := 'create';
    INSERT INTO public.production_flow_substances (
      substance_code, substance_name, cas_number, density_kg_l,
      regulatory_class, default_unit, default_concentration_pct,
      is_active, notes, metadata, created_by
    ) VALUES (
      p_substance_code, p_substance_name, p_cas_number, p_density_kg_l,
      p_regulatory_class, p_default_unit, p_default_concentration_pct,
      p_is_active, p_notes, p_metadata, auth.uid()
    )
    RETURNING id INTO v_result_id;
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := v_action::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := v_result_id::text,
    p_entity_type := 'production_flow_substance',
    p_new_values := jsonb_build_object('substance_code', p_substance_code, 'regulatory_class', p_regulatory_class),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := format('Admin %s production flow substance %s', v_action, p_substance_code),
    p_tags := ARRAY['admin', 'flow_tracking'],
    p_user_id := auth.uid()
  );

  RETURN v_result_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_production_flow_substance_admin(text, numeric, text, numeric, uuid, boolean, jsonb, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_production_flow_substance_admin(text, numeric, text, numeric, uuid, boolean, jsonb, text, text, text, text) TO authenticated;
