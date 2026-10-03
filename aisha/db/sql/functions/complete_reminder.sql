-- Function: public.complete_reminder
-- Arguments: p_reminder_id uuid, p_quick_response jsonb, p_questionnaire_response_id uuid, p_health_check_in_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:00+01:00

CREATE OR REPLACE FUNCTION public.complete_reminder(p_reminder_id uuid, p_quick_response jsonb DEFAULT NULL::jsonb, p_questionnaire_response_id uuid DEFAULT NULL::uuid, p_health_check_in_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_points INTEGER;
  v_completion_id UUID;
  v_new_balance NUMERIC;
  v_reminder_title TEXT;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- RATE LIMITING: 20 requests per minute
  PERFORM enforce_rate_limit('complete_reminder', 60000, 20);

  -- Get reminder details and verify ownership
  SELECT points_per_completion, title INTO v_points, v_reminder_title
  FROM user_reminders
  WHERE id = p_reminder_id AND user_id = v_user_id;

  IF v_points IS NULL THEN
    RAISE EXCEPTION 'Reminder not found or access denied';
  END IF;

  -- Check if already completed today
  IF EXISTS (
    SELECT 1 FROM reminder_completions
    WHERE reminder_id = p_reminder_id
      AND user_id = v_user_id
      AND DATE(completed_at) = CURRENT_DATE
  ) THEN
    RAISE EXCEPTION 'Reminder already completed today';
  END IF;

  -- Create completion record
  INSERT INTO reminder_completions (
    user_id,
    reminder_id,
    quick_response,
    questionnaire_response_id,
    health_check_in_id,
    points_awarded,
    scheduled_for,
    completed_at
  ) VALUES (
    v_user_id,
    p_reminder_id,
    p_quick_response,
    p_questionnaire_response_id,
    p_health_check_in_id,
    v_points,
    now(), -- Simplified: should calculate actual scheduled time
    now()
  )
  RETURNING id INTO v_completion_id;

  -- Award points via token system
  INSERT INTO token_transactions (
    to_user_id,
    amount,
    transaction_type,
    reference_type,
    reference_id,
    description,
    created_at
  ) VALUES (
    v_user_id,
    v_points,
    'reward',
    'reminder_completion',
    v_completion_id,
    format('Completed: %s', v_reminder_title),
    now()
  );

  -- Update user token balance
  INSERT INTO token_allocations (user_id, balance, updated_at)
  VALUES (v_user_id, v_points, now())
  ON CONFLICT (user_id)
  DO UPDATE SET
    balance = token_allocations.balance + v_points,
    updated_at = now()
  RETURNING balance INTO v_new_balance;

  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'insert'::journal_action_type,
      p_area := 'mobile'::journal_area,
      p_details := jsonb_build_object(
      'reminder_id', p_reminder_id,
      'points_awarded', v_points
    ),
      p_entity_id := v_completion_id,
      p_entity_type := 'reminder_completions',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::journal_severity,
      p_summary := 'User completed reminder',
      p_tags := ARRAY['mobile', 'gamification', 'reminder'],
      p_user_id := v_user_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'completion_id', v_completion_id,
    'points_awarded', v_points,
    'new_balance', v_new_balance
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.complete_reminder(p_reminder_id uuid, p_quick_response jsonb, p_questionnaire_response_id uuid, p_health_check_in_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_reminder(p_reminder_id uuid, p_quick_response jsonb, p_questionnaire_response_id uuid, p_health_check_in_id uuid) TO authenticated;
