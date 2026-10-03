-- Function: public.get_production_flow_records_admin
-- Returns production flow records with optional filters
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.get_production_flow_records_admin(
  p_batch_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 200,
  p_offset integer DEFAULT 0,
  p_source_node_id uuid DEFAULT NULL,
  p_substance_id uuid DEFAULT NULL,
  p_target_node_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  batch_id uuid,
  substance_id uuid,
  source_node_id uuid,
  target_node_id uuid,
  flow_date timestamptz,
  volume_l numeric,
  concentration_pct numeric,
  pure_amount_l numeric,
  temperature_c numeric,
  lot_id uuid,
  responsible_user_id uuid,
  notes text,
  metadata jsonb,
  created_at timestamptz
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
    p_entity_type := 'production_flow_record',
    p_new_values := jsonb_build_object(
      'batch_id', p_batch_id,
      'substance_id', p_substance_id,
      'source_node_id', p_source_node_id,
      'target_node_id', p_target_node_id,
      'limit', p_limit,
      'offset', p_offset
    ),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin read production flow records',
    p_tags := ARRAY['admin', 'flow_tracking'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    r.id, r.batch_id, r.substance_id,
    r.source_node_id, r.target_node_id,
    r.flow_date, r.volume_l, r.concentration_pct, r.pure_amount_l,
    r.temperature_c, r.lot_id, r.responsible_user_id,
    r.notes, r.metadata, r.created_at
  FROM public.production_flow_records r
  WHERE (p_batch_id IS NULL OR r.batch_id = p_batch_id)
    AND (p_substance_id IS NULL OR r.substance_id = p_substance_id)
    AND (p_source_node_id IS NULL OR r.source_node_id = p_source_node_id)
    AND (p_target_node_id IS NULL OR r.target_node_id = p_target_node_id)
  ORDER BY r.flow_date DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_flow_records_admin(uuid, integer, integer, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_flow_records_admin(uuid, integer, integer, uuid, uuid, uuid) TO authenticated;
