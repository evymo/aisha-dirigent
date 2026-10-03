-- Function: public.get_my_compliance_summary
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:54+01:00

CREATE OR REPLACE FUNCTION public.get_my_compliance_summary()
 RETURNS TABLE(total_required integer, total_completed integer, compliance_score numeric, current_streak integer, total_tokens_earned integer, is_eligible_for_discount boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_total_doses INTEGER;
  v_logged_doses INTEGER;
  v_streak INTEGER;
  v_tokens INTEGER;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Audit log for sensitive data access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'member',
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'dosing_logs',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Member viewing compliance summary',
      p_tags := ARRAY['phi','member','compliance'],
      p_user_id := v_user_id
  );

  -- Count dosing logs
  SELECT COUNT(*) INTO v_logged_doses
  FROM dosing_logs
  WHERE user_id = v_user_id;

  -- Calculate expected doses (simplified: 3 per day since registration)
  SELECT COALESCE(SUM(
    GREATEST(1, EXTRACT(DAY FROM now() - enrolled_at)::INTEGER) * 3
  ), 0)::INTEGER INTO v_total_doses
  FROM study_registrations
  WHERE user_id = v_user_id AND status IN ('enrolled', 'active');

  -- Calculate streak (consecutive days with logs)
  WITH daily_logs AS (
    SELECT DISTINCT DATE(logged_at) as log_date
    FROM dosing_logs
    WHERE user_id = v_user_id
    ORDER BY log_date DESC
  ),
  streak_calc AS (
    SELECT log_date,
           log_date - (ROW_NUMBER() OVER (ORDER BY log_date DESC))::INTEGER AS grp
    FROM daily_logs
    WHERE log_date >= CURRENT_DATE - 30
  )
  SELECT COALESCE(COUNT(*), 0)::INTEGER INTO v_streak
  FROM streak_calc
  WHERE grp = (SELECT grp FROM streak_calc WHERE log_date = CURRENT_DATE LIMIT 1);

  -- Get tokens earned
  SELECT COALESCE(SUM(amount), 0)::INTEGER INTO v_tokens
  FROM token_transactions
  WHERE user_id = v_user_id AND reference_type = 'dosing_log';

  RETURN QUERY
  SELECT 
    GREATEST(1, COALESCE(v_total_doses, 1)) as total_required,
    COALESCE(v_logged_doses, 0) as total_completed,
    CASE WHEN v_total_doses > 0 
      THEN LEAST(1.0, v_logged_doses::NUMERIC / v_total_doses::NUMERIC)
      ELSE 0.0
    END as compliance_score,
    COALESCE(v_streak, 0) as current_streak,
    COALESCE(v_tokens, 0) as total_tokens_earned,
    (v_logged_doses::NUMERIC / GREATEST(1, v_total_doses)::NUMERIC >= 0.9) as is_eligible_for_discount;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_compliance_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_compliance_summary() TO authenticated;
