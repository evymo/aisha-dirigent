-- Function: public.get_production_resources_admin
-- Returns equipment and work center registry
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.get_production_resources_admin(
  p_resource_type text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  resource_code text,
  resource_name text,
  resource_type text,
  power_kw numeric,
  location text,
  capacity_info text,
  operating_cost_per_hour numeric,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
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
    p_entity_type := 'production_resource',
    p_new_values := jsonb_build_object('resource_type', p_resource_type),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin read production resources',
    p_tags := ARRAY['admin', 'production_resource'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    pr.id, pr.resource_code, pr.resource_name, pr.resource_type,
    pr.power_kw, pr.location, pr.capacity_info,
    pr.operating_cost_per_hour, pr.is_active,
    pr.created_at, pr.updated_at
  FROM public.production_resources pr
  WHERE (p_resource_type IS NULL OR pr.resource_type = p_resource_type)
    AND pr.is_active = true
  ORDER BY pr.resource_type, pr.resource_code;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_resources_admin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_resources_admin(text) TO authenticated;
