-- Function: public.upsert_production_flow_node_admin
-- Creates or updates a production flow node
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.upsert_production_flow_node_admin(
  p_capacity_l numeric DEFAULT NULL,
  p_default_concentration_pct numeric DEFAULT NULL,
  p_equipment_id uuid DEFAULT NULL,
  p_id uuid DEFAULT NULL,
  p_is_active boolean DEFAULT true,
  p_location_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_node_code text DEFAULT NULL,
  p_node_name text DEFAULT NULL,
  p_node_type text DEFAULT 'storage',
  p_notes text DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL
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

  IF p_node_code IS NULL OR p_node_name IS NULL THEN
    RAISE EXCEPTION 'node_code and node_name are required';
  END IF;

  IF p_id IS NOT NULL THEN
    v_action := 'update';
    UPDATE public.production_flow_nodes SET
      node_code = p_node_code,
      node_name = p_node_name,
      node_type = p_node_type,
      location_id = p_location_id,
      supplier_id = p_supplier_id,
      equipment_id = p_equipment_id,
      capacity_l = p_capacity_l,
      default_concentration_pct = p_default_concentration_pct,
      is_active = p_is_active,
      notes = p_notes,
      metadata = p_metadata,
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_result_id;
  ELSE
    v_action := 'create';
    INSERT INTO public.production_flow_nodes (
      node_code, node_name, node_type, location_id, supplier_id,
      equipment_id, capacity_l, default_concentration_pct,
      is_active, notes, metadata, created_by
    ) VALUES (
      p_node_code, p_node_name, p_node_type, p_location_id, p_supplier_id,
      p_equipment_id, p_capacity_l, p_default_concentration_pct,
      p_is_active, p_notes, p_metadata, auth.uid()
    )
    RETURNING id INTO v_result_id;
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := v_action::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := v_result_id::text,
    p_entity_type := 'production_flow_node',
    p_new_values := jsonb_build_object('node_code', p_node_code, 'node_type', p_node_type),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := format('Admin %s production flow node %s', v_action, p_node_code),
    p_tags := ARRAY['admin', 'flow_tracking'],
    p_user_id := auth.uid()
  );

  RETURN v_result_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_production_flow_node_admin(numeric, numeric, uuid, uuid, boolean, uuid, jsonb, text, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_production_flow_node_admin(numeric, numeric, uuid, uuid, boolean, uuid, jsonb, text, text, text, text, uuid) TO authenticated;
