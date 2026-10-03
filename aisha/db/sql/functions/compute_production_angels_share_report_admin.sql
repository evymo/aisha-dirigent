-- Function: public.compute_production_angels_share_report_admin
-- Arguments: p_batch_id uuid, p_date_from timestamptz, p_date_to timestamptz, p_substance_id uuid
-- Description: Server-side computation for Angels' Share (production loss) customs authority reporting.
-- Security: SECURITY DEFINER, admin/staff only
-- Source: Migration 20260219180000_production_enhancements.sql

CREATE OR REPLACE FUNCTION public.compute_production_angels_share_report_admin(
  p_batch_id uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_substance_id uuid DEFAULT NULL
)
RETURNS TABLE(
  batch_id uuid,
  batch_code text,
  substance_id uuid,
  substance_name text,
  substance_cas_number text,
  regulatory_class text,
  total_input_volume_l numeric,
  total_input_pure_l numeric,
  total_output_volume_l numeric,
  total_output_pure_l numeric,
  total_waste_volume_l numeric,
  total_waste_pure_l numeric,
  loss_volume_l numeric,
  loss_pure_l numeric,
  loss_pct numeric,
  loss_pure_pct numeric,
  record_count bigint,
  first_record_date timestamptz,
  last_record_date timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  -- Audit this sensitive report access
  PERFORM public.write_audit_journal(
    p_action_type := 'export'::public.journal_action_type,
    p_area := 'production'::public.journal_area,
    p_details := NULL,
    p_entity_id := COALESCE(p_batch_id::text, 'all'),
    p_entity_type := 'angels_share_report',
    p_new_values := jsonb_build_object(
      'date_from', p_date_from,
      'date_to', p_date_to,
      'substance_id', p_substance_id
    ),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Angels Share report generated for customs authority',
    p_tags := ARRAY['admin', 'angels_share', 'customs_report', 'regulatory'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  WITH filtered_records AS (
    SELECT
      r.batch_id AS r_batch_id,
      r.substance_id AS r_substance_id,
      r.source_node_id,
      r.target_node_id,
      r.volume_l,
      r.pure_amount_l,
      r.flow_date,
      sn.node_type AS source_type,
      tn.node_type AS target_type
    FROM production_flow_records r
    JOIN production_flow_nodes sn ON sn.id = r.source_node_id
    JOIN production_flow_nodes tn ON tn.id = r.target_node_id
    WHERE r.is_storno = false
      AND (p_batch_id IS NULL OR r.batch_id = p_batch_id)
      AND (p_substance_id IS NULL OR r.substance_id = p_substance_id)
      AND (p_date_from IS NULL OR r.flow_date >= p_date_from)
      AND (p_date_to IS NULL OR r.flow_date <= p_date_to)
  ),
  aggregated AS (
    SELECT
      fr.r_batch_id,
      fr.r_substance_id,
      -- Input = volume dispatched FROM supplier nodes
      SUM(CASE WHEN fr.source_type = 'supplier' THEN fr.volume_l ELSE 0 END) AS input_vol,
      SUM(CASE WHEN fr.source_type = 'supplier' THEN fr.pure_amount_l ELSE 0 END) AS input_pure,
      -- Output = volume received BY finished nodes
      SUM(CASE WHEN fr.target_type = 'finished' THEN fr.volume_l ELSE 0 END) AS output_vol,
      SUM(CASE WHEN fr.target_type = 'finished' THEN fr.pure_amount_l ELSE 0 END) AS output_pure,
      -- Waste = volume received BY waste nodes
      SUM(CASE WHEN fr.target_type = 'waste' THEN fr.volume_l ELSE 0 END) AS waste_vol,
      SUM(CASE WHEN fr.target_type = 'waste' THEN fr.pure_amount_l ELSE 0 END) AS waste_pure,
      COUNT(*) AS rec_count,
      MIN(fr.flow_date) AS first_date,
      MAX(fr.flow_date) AS last_date
    FROM filtered_records fr
    GROUP BY fr.r_batch_id, fr.r_substance_id
  )
  SELECT
    a.r_batch_id AS batch_id,
    pb.batch_code,
    a.r_substance_id AS substance_id,
    fs.substance_name,
    fs.cas_number AS substance_cas_number,
    fs.regulatory_class,
    a.input_vol AS total_input_volume_l,
    a.input_pure AS total_input_pure_l,
    a.output_vol AS total_output_volume_l,
    a.output_pure AS total_output_pure_l,
    a.waste_vol AS total_waste_volume_l,
    a.waste_pure AS total_waste_pure_l,
    (a.input_vol - a.output_vol - a.waste_vol) AS loss_volume_l,
    (a.input_pure - a.output_pure - a.waste_pure) AS loss_pure_l,
    CASE WHEN a.input_vol > 0
      THEN ROUND(((a.input_vol - a.output_vol - a.waste_vol) / a.input_vol) * 100, 4)
      ELSE 0 END AS loss_pct,
    CASE WHEN a.input_pure > 0
      THEN ROUND(((a.input_pure - a.output_pure - a.waste_pure) / a.input_pure) * 100, 4)
      ELSE 0 END AS loss_pure_pct,
    a.rec_count AS record_count,
    a.first_date AS first_record_date,
    a.last_date AS last_record_date
  FROM aggregated a
  JOIN production_batches pb ON pb.id = a.r_batch_id
  JOIN production_flow_substances fs ON fs.id = a.r_substance_id
  ORDER BY pb.batch_code, fs.substance_name;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_production_angels_share_report_admin(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_production_angels_share_report_admin(uuid, timestamptz, timestamptz, uuid) TO authenticated;
