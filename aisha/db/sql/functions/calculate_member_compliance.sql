-- Function: public.calculate_member_compliance
-- Arguments: p_member_token uuid, p_period_start date, p_period_end date
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:54+01:00

CREATE OR REPLACE FUNCTION public.calculate_member_compliance(p_member_token uuid, p_period_start date, p_period_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_required_checkins INTEGER;
  v_completed_checkins INTEGER;
  v_required_dosing INTEGER;
  v_completed_dosing INTEGER;
  v_score NUMERIC;
BEGIN
  -- Get user_id from member_distribution_plans
  SELECT user_id INTO v_user_id
  FROM member_distribution_plans
  WHERE member_token = p_member_token;
  
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Member not found');
  END IF;
  
  -- Count required check-ins (days in period)
  v_required_checkins := (p_period_end - p_period_start);
  
  -- Count completed check-ins
  SELECT COUNT(*) INTO v_completed_checkins
  FROM health_check_ins
  WHERE user_id = v_user_id
    AND check_in_date >= p_period_start
    AND check_in_date <= p_period_end;
  
  -- Count required dosing logs (days * doses_per_day from protocol)
  SELECT COALESCE(SUM(
    COALESCE(sdp.doses_per_day, 1) * (p_period_end - p_period_start)
  ), 0)
  INTO v_required_dosing
  FROM member_distribution_plans mdp
  JOIN study_distribution_protocols sdp ON sdp.id = mdp.protocol_id
  WHERE mdp.member_token = p_member_token
    AND mdp.status = 'active';
  
  -- Count completed dosing logs
  SELECT COUNT(*) INTO v_completed_dosing
  FROM dosing_logs
  WHERE user_id = v_user_id
    AND logged_at >= p_period_start
    AND logged_at <= p_period_end;
  
  -- Upsert compliance score
  INSERT INTO member_compliance_scores (
    member_token,
    period_start,
    period_end,
    required_checkins,
    completed_checkins,
    required_dosing_logs,
    completed_dosing_logs
  ) VALUES (
    p_member_token,
    p_period_start,
    p_period_end,
    v_required_checkins,
    LEAST(v_completed_checkins, v_required_checkins),
    v_required_dosing,
    LEAST(v_completed_dosing, v_required_dosing)
  )
  ON CONFLICT (member_token, period_start)
  DO UPDATE SET
    required_checkins = EXCLUDED.required_checkins,
    completed_checkins = EXCLUDED.completed_checkins,
    required_dosing_logs = EXCLUDED.required_dosing_logs,
    completed_dosing_logs = EXCLUDED.completed_dosing_logs;
  
  -- Return result
  SELECT jsonb_build_object(
    'member_token', member_token,
    'period', jsonb_build_object('start', period_start, 'end', period_end),
    'compliance_score', compliance_score,
    'checkins', jsonb_build_object('required', required_checkins, 'completed', completed_checkins),
    'dosing', jsonb_build_object('required', required_dosing_logs, 'completed', completed_dosing_logs)
  )
  INTO v_score
  FROM member_compliance_scores
  WHERE member_token = p_member_token AND period_start = p_period_start;
  
  RETURN v_score;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.calculate_member_compliance(p_member_token uuid, p_period_start date, p_period_end date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calculate_member_compliance(p_member_token uuid, p_period_start date, p_period_end date) TO authenticated;
