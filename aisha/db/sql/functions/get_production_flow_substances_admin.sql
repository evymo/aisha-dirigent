-- Function: public.get_production_flow_substances_admin
-- Returns production flow substances (master data)
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.get_production_flow_substances_admin(
  p_is_active boolean DEFAULT NULL,
  p_regulatory_class text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  substance_code text,
  substance_name text,
  cas_number text,
  density_kg_l numeric,
  regulatory_class text,
  default_unit text,
  default_concentration_pct numeric,
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
    p_entity_type := 'production_flow_substance',
    p_new_values := jsonb_build_object('regulatory_class', p_regulatory_class, 'is_active', p_is_active),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin read production flow substances',
    p_tags := ARRAY['admin', 'flow_tracking'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    s.id, s.substance_code, s.substance_name, s.cas_number,
    s.density_kg_l, s.regulatory_class, s.default_unit,
    s.default_concentration_pct, s.is_active,
    s.notes, s.metadata, s.created_at, s.updated_at, s.created_by
  FROM public.production_flow_substances s
  WHERE (p_regulatory_class IS NULL OR s.regulatory_class = p_regulatory_class)
    AND (p_is_active IS NULL OR s.is_active = p_is_active)
  ORDER BY s.substance_code;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_flow_substances_admin(boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_flow_substances_admin(boolean, text) TO authenticated;
