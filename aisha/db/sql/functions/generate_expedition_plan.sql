-- Function: public.generate_expedition_plan
-- Arguments: p_expedition_date date, p_cut_off_date date
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:29+01:00

CREATE OR REPLACE FUNCTION public.generate_expedition_plan(p_expedition_date date, p_cut_off_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_cut_off DATE;
  v_result JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_admin_or_staff(v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_cut_off := COALESCE(p_cut_off_date, p_expedition_date - INTERVAL '3 days');

  SELECT jsonb_build_object(
    'expedition_date', p_expedition_date,
    'cut_off_date', v_cut_off,
    'plans', COALESCE((
      SELECT jsonb_agg(row_to_json(t))
      FROM (
        SELECT 
          p.id AS product_id,
          p.name AS product_name,
          s.id AS study_id,
          s.name AS study_name,
          COUNT(DISTINCT se.user_id) AS member_count,
          COUNT(DISTINCT se.user_id) AS packages_needed
        FROM study_registrations se
        JOIN studies s ON se.study_id = s.id
        LEFT JOIN products p ON true
        WHERE se.status = 'active'
        GROUP BY p.id, p.name, s.id, s.name
      ) t
    ), '[]'::jsonb)
  )
  INTO v_result;

  INSERT INTO audit_journal (user_id, action_type, area, entity_type, summary, severity)
  VALUES (v_user_id, 'create', 'admin', 'expedition_plan', 'Generated expedition plan', 'info');

  RETURN v_result;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.generate_expedition_plan(p_expedition_date date, p_cut_off_date date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_expedition_plan(p_expedition_date date, p_cut_off_date date) TO authenticated;
