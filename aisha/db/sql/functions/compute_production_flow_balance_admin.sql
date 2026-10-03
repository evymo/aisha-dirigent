-- Function: public.compute_production_flow_balance_admin
-- Computes substance balance per batch: per-node receipts/dispatches, total input,
-- total accounted, loss (Angels' Share), loss percentage.
-- This is the KEY function for dynamic recalculation of flow balances.
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.compute_production_flow_balance_admin(
  p_batch_id uuid DEFAULT NULL,
  p_substance_id uuid DEFAULT NULL
)
RETURNS TABLE(
  node_id uuid,
  node_code text,
  node_name text,
  node_type text,
  total_received_volume_l numeric,
  total_received_pure_l numeric,
  total_dispatched_volume_l numeric,
  total_dispatched_pure_l numeric,
  balance_volume_l numeric,
  balance_pure_l numeric,
  avg_concentration_pct numeric,
  record_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'batch_id is required for balance computation';
  END IF;

  IF p_substance_id IS NULL THEN
    RAISE EXCEPTION 'substance_id is required for balance computation';
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := 'read'::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := p_batch_id::text,
    p_entity_type := 'production_flow_balance',
    p_new_values := jsonb_build_object('batch_id', p_batch_id, 'substance_id', p_substance_id),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin computed flow balance',
    p_tags := ARRAY['admin', 'flow_tracking', 'balance'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  WITH received AS (
    SELECT
      r.target_node_id AS nid,
      COALESCE(SUM(r.volume_l), 0) AS vol,
      COALESCE(SUM(r.pure_amount_l), 0) AS pure,
      COUNT(*) AS cnt
    FROM public.production_flow_records r
    WHERE r.batch_id = p_batch_id
      AND r.substance_id = p_substance_id
    GROUP BY r.target_node_id
  ),
  dispatched AS (
    SELECT
      r.source_node_id AS nid,
      COALESCE(SUM(r.volume_l), 0) AS vol,
      COALESCE(SUM(r.pure_amount_l), 0) AS pure,
      COUNT(*) AS cnt
    FROM public.production_flow_records r
    WHERE r.batch_id = p_batch_id
      AND r.substance_id = p_substance_id
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
    COALESCE(recv.vol, 0),
    COALESCE(recv.pure, 0),
    COALESCE(disp.vol, 0),
    COALESCE(disp.pure, 0),
    COALESCE(recv.vol, 0) - COALESCE(disp.vol, 0),
    COALESCE(recv.pure, 0) - COALESCE(disp.pure, 0),
    CASE
      WHEN COALESCE(recv.vol, 0) - COALESCE(disp.vol, 0) > 0 THEN
        (COALESCE(recv.pure, 0) - COALESCE(disp.pure, 0)) /
        (COALESCE(recv.vol, 0) - COALESCE(disp.vol, 0)) * 100.0
      ELSE 0
    END,
    COALESCE(recv.cnt, 0) + COALESCE(disp.cnt, 0)
  FROM all_nodes an
  JOIN public.production_flow_nodes n ON n.id = an.nid
  LEFT JOIN received recv ON recv.nid = an.nid
  LEFT JOIN dispatched disp ON disp.nid = an.nid
  ORDER BY n.node_type, n.node_code;
END;
$function$;

REVOKE ALL ON FUNCTION public.compute_production_flow_balance_admin(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_production_flow_balance_admin(uuid, uuid) TO authenticated;
