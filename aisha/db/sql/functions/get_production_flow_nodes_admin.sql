-- Function: public.get_production_flow_nodes_admin
-- Returns production flow nodes (master data)
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.get_production_flow_nodes_admin(
  p_is_active boolean DEFAULT NULL,
  p_node_type text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  node_code text,
  node_name text,
  node_type text,
  location_id uuid,
  supplier_id uuid,
  equipment_id uuid,
  capacity_l numeric,
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
    p_entity_type := 'production_flow_node',
    p_new_values := jsonb_build_object('node_type', p_node_type, 'is_active', p_is_active),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin read production flow nodes',
    p_tags := ARRAY['admin', 'flow_tracking'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    n.id, n.node_code, n.node_name, n.node_type,
    n.location_id, n.supplier_id, n.equipment_id,
    n.capacity_l, n.default_concentration_pct, n.is_active,
    n.notes, n.metadata, n.created_at, n.updated_at, n.created_by
  FROM public.production_flow_nodes n
  WHERE (p_node_type IS NULL OR n.node_type = p_node_type)
    AND (p_is_active IS NULL OR n.is_active = p_is_active)
  ORDER BY n.node_code;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_flow_nodes_admin(boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_flow_nodes_admin(boolean, text) TO authenticated;
