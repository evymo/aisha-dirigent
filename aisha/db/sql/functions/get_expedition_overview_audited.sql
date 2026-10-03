-- Function: public.get_expedition_overview_audited
-- Arguments: p_start_date date, p_end_date date
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:47+01:00

CREATE OR REPLACE FUNCTION public.get_expedition_overview_audited(p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_result JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_admin_or_staff(v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT 
      ec.id,
      ec.expedition_date,
      ec.cut_off_date,
      p.name AS product_name,
      ec.product_id,
      s.name AS study_name,
      ec.study_id,
      ec.planned_shipments,
      ec.confirmed_shipments,
      ec.packed_shipments,
      ec.sent_shipments,
      ec.status,
      -- Return actual allocated_batches from expedition_calendar
      COALESCE(ec.allocated_batches, '[]'::jsonb) AS allocated_batches,
      ec.notes
    FROM expedition_calendar ec
    LEFT JOIN products p ON ec.product_id = p.id
    LEFT JOIN studies s ON ec.study_id = s.id
    WHERE (p_start_date IS NULL OR ec.expedition_date >= p_start_date)
      AND (p_end_date IS NULL OR ec.expedition_date <= p_end_date)
    ORDER BY ec.expedition_date
  ) t;

  -- Audit log
  INSERT INTO audit_journal (user_id, action_type, area, entity_type, summary, severity, details)
  VALUES (
    v_user_id, 
    'view', 
    'logistics', 
    'expedition', 
    'Viewed expedition overview', 
    'info',
    jsonb_build_object('start_date', p_start_date, 'end_date', p_end_date)
  );

  RETURN v_result;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_expedition_overview_audited(p_start_date date, p_end_date date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_expedition_overview_audited(p_start_date date, p_end_date date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_expedition_overview_audited(p_start_date date, p_end_date date) TO authenticated;
