-- Function: public.get_production_flow_node_inventory_admin
-- Returns current inventory state per node for a given substance:
-- current volume, average concentration, pure amount, last flow date.
-- Optionally filtered by batch_id; without batch_id returns all-time inventory.
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.get_production_flow_node_inventory_admin(
  p_batch_id uuid DEFAULT NULL,
  p_node_id uuid DEFAULT NULL,
  p_substance_id uuid DEFAULT NULL
)
RETURNS TABLE(
  node_id uuid,
  node_code text,
  node_name text,
  node_type text,
  current_volume_l numeric,
  current_pure_l numeric,
  avg_concentration_pct numeric,
  last_flow_date timestamptz,
  total_records bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  IF p_substance_id IS NULL THEN
    RAISE EXCEPTION 'substance_id is required for inventory query';
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := 'read'::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := COALESCE(p_node_id::text, 'all'),
    p_entity_type := 'production_flow_node_inventory',
    p_new_values := jsonb_build_object(
      'substance_id', p_substance_id,
      'batch_id', p_batch_id,
      'node_id', p_node_id
    ),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin queried flow node inventory',
    p_tags := ARRAY['admin', 'flow_tracking', 'inventory'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  WITH received AS (
    SELECT
      r.target_node_id AS nid,
      SUM(r.volume_l) AS vol,
      SUM(r.pure_amount_l) AS pure,
      MAX(r.flow_date) AS last_dt,
      COUNT(*) AS cnt
    FROM public.production_flow_records r
    WHERE r.substance_id = p_substance_id
      AND (p_batch_id IS NULL OR r.batch_id = p_batch_id)
      AND (p_node_id IS NULL OR r.target_node_id = p_node_id)
    GROUP BY r.target_node_id
  ),
  dispatched AS (
    SELECT
      r.source_node_id AS nid,
      SUM(r.volume_l) AS vol,
      SUM(r.pure_amount_l) AS pure,
      MAX(r.flow_date) AS last_dt,
      COUNT(*) AS cnt
    FROM public.production_flow_records r
    WHERE r.substance_id = p_substance_id
      AND (p_batch_id IS NULL OR r.batch_id = p_batch_id)
      AND (p_node_id IS NULL OR r.source_node_id = p_node_id)
    GROUP BY r.source_node_id
  ),
  all_nodes AS (
    SELECT nid FROM received
    UNION
    SELECT nid FROM dispatched
  )
  SELECT
    n.id,
    n.node_code,
    n.node_name,
    n.node_type,
    COALESCE(recv.vol, 0) - COALESCE(disp.vol, 0),
    COALESCE(recv.pure, 0) - COALESCE(disp.pure, 0),
    CASE
      WHEN (COALESCE(recv.vol, 0) - COALESCE(disp.vol, 0)) > 0 THEN
        (COALESCE(recv.pure, 0) - COALESCE(disp.pure, 0)) /
        (COALESCE(recv.vol, 0) - COALESCE(disp.vol, 0)) * 100.0
      ELSE 0
    END,
    GREATEST(recv.last_dt, disp.last_dt),
    COALESCE(recv.cnt, 0) + COALESCE(disp.cnt, 0)
  FROM all_nodes an
  JOIN public.production_flow_nodes n ON n.id = an.nid
  LEFT JOIN received recv ON recv.nid = an.nid
  LEFT JOIN dispatched disp ON disp.nid = an.nid
  WHERE (COALESCE(recv.vol, 0) - COALESCE(disp.vol, 0)) > 0
     OR p_node_id IS NOT NULL  -- if specific node requested, show even zero inventory
  ORDER BY n.node_type, n.node_code;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_flow_node_inventory_admin(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_flow_node_inventory_admin(uuid, uuid, uuid) TO authenticated;
