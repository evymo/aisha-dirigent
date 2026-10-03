-- Function: public.get_my_dosing_logs_audited
-- Arguments: p_limit integer
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:56+01:00

CREATE OR REPLACE FUNCTION public.get_my_dosing_logs_audited(p_limit integer DEFAULT 30)
 RETURNS TABLE(id uuid, user_id uuid, product_id uuid, study_registration_id uuid, logged_at timestamptz, dose_amount text, dose_unit text, dose_count integer, taken_with_food boolean, notes text, created_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'studies',
      p_details := jsonb_build_object('result', 'granted', 'limit', GREATEST(0, COALESCE(p_limit, 0))),
      p_entity_id := NULL,
      p_entity_type := 'dosing_log',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Member viewed dosing logs',
      p_tags := ARRAY['phi','member','dosing_logs'],
      p_user_id := v_uid
  );

  RETURN QUERY
    SELECT
      d.id,
      d.user_id,
      d.product_id,
      d.study_registration_id,
      d.logged_at,
      d.dose_amount,
      d.dose_unit,
      d.dose_count,
      d.taken_with_food,
      d.notes,
      d.created_at
    FROM public.dosing_logs d
    WHERE d.user_id = v_uid
    ORDER BY d.logged_at DESC
    LIMIT GREATEST(0, COALESCE(p_limit, 0));
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_dosing_logs_audited(p_limit integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_dosing_logs_audited(p_limit integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_dosing_logs_audited(p_limit integer) TO authenticated;
