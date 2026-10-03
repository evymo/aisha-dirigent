-- Function: public.submit_questionnaire_response
-- Arguments: p_questionnaire_id uuid, p_responses jsonb, p_study_registration_id uuid
-- Description: Submit questionnaire response with scheduling + rewards (sensitive data)
-- @security: authenticated
-- @audit: required
-- @phi: true

CREATE OR REPLACE FUNCTION public.submit_questionnaire_response(
  p_questionnaire_id uuid,
  p_responses jsonb,
  p_study_registration_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_response_id UUID;
  v_points INTEGER := 0;
  v_new_balance NUMERIC;
  v_questionnaire record;
  v_registration record;
  v_study_questionnaire record;
  v_last_completed TIMESTAMPTZ;
  v_available_from date;
  v_available_until date;
  v_frequency_days int;
  v_questionnaire_version int;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  PERFORM enforce_rate_limit('submit_questionnaire_response', 60000, 10);

  IF jsonb_typeof(p_responses) != 'object' THEN
    RAISE EXCEPTION 'p_responses must be a JSON object';
  END IF;

  SELECT id, name, code, version, token_reward, points_reward
  INTO v_questionnaire
  FROM questionnaires
  WHERE id = p_questionnaire_id
    AND is_active = true;

  IF v_questionnaire.id IS NULL THEN
    RAISE EXCEPTION 'Questionnaire not found or inactive';
  END IF;

  IF p_study_registration_id IS NOT NULL THEN
    SELECT id, study_id, enrolled_at::date AS enrolled_date
    INTO v_registration
    FROM study_registrations
    WHERE id = p_study_registration_id
      AND user_id = v_user_id
      AND status::text IN ('enrolled', 'active');

    IF v_registration.id IS NULL THEN
      RAISE EXCEPTION 'Study registration not found or inactive';
    END IF;

    SELECT *
    INTO v_study_questionnaire
    FROM study_questionnaires
    WHERE study_id = v_registration.study_id
      AND questionnaire_id = p_questionnaire_id
      AND is_active = true;

    IF v_study_questionnaire.id IS NULL THEN
      RAISE EXCEPTION 'Questionnaire not configured for study';
    END IF;

    v_points := COALESCE(
      v_study_questionnaire.token_reward,
      v_questionnaire.token_reward,
      v_questionnaire.points_reward,
      0
    );

    v_questionnaire_version := COALESCE(
      v_study_questionnaire.questionnaire_version,
      v_questionnaire.version,
      1
    );

    v_available_from := v_registration.enrolled_date + COALESCE(v_study_questionnaire.starts_after_days, 0);
    v_available_until := CASE
      WHEN v_study_questionnaire.ends_after_days IS NULL THEN NULL
      ELSE v_registration.enrolled_date + v_study_questionnaire.ends_after_days
    END;

    IF current_date < v_available_from THEN
      RAISE EXCEPTION 'Questionnaire not available yet';
    END IF;

    IF v_available_until IS NOT NULL AND current_date > v_available_until THEN
      RAISE EXCEPTION 'Questionnaire no longer available';
    END IF;

    v_frequency_days := COALESCE(
      v_study_questionnaire.frequency_days,
      CASE
        WHEN COALESCE(v_study_questionnaire.frequency_type, v_study_questionnaire.questionnaire_type) = 'daily' THEN 1
        WHEN COALESCE(v_study_questionnaire.frequency_type, v_study_questionnaire.questionnaire_type) = 'weekly' THEN 7
        WHEN COALESCE(v_study_questionnaire.frequency_type, v_study_questionnaire.questionnaire_type) = 'monthly' THEN 30
        ELSE NULL
      END
    );

    SELECT MAX(completed_at)
    INTO v_last_completed
    FROM questionnaire_responses
    WHERE user_id = v_user_id
      AND questionnaire_id = p_questionnaire_id
      AND study_registration_id = p_study_registration_id;

    IF v_last_completed IS NOT NULL THEN
      IF v_frequency_days IS NULL THEN
        RAISE EXCEPTION 'Questionnaire already completed';
      ELSIF v_last_completed::date >= current_date - make_interval(days => v_frequency_days) THEN
        RAISE EXCEPTION 'Questionnaire already completed in this period';
      END IF;
    END IF;
  ELSE
    v_points := COALESCE(
      v_questionnaire.token_reward,
      v_questionnaire.points_reward,
      0
    );
    v_questionnaire_version := COALESCE(v_questionnaire.version, 1);
  END IF;

  INSERT INTO questionnaire_responses (
    user_id,
    questionnaire_id,
    responses,
    study_registration_id,
    completed_at,
    questionnaire_version
  ) VALUES (
    v_user_id,
    p_questionnaire_id,
    p_responses,
    p_study_registration_id,
    now(),
    v_questionnaire_version
  )
  RETURNING id INTO v_response_id;

  -- Award points via token system
  IF v_points > 0 THEN
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
      'questionnaire_response',
      v_response_id,
      format('Completed questionnaire: %s', v_questionnaire.name),
      now()
    );

    INSERT INTO token_allocations (user_id, balance, updated_at)
    VALUES (v_user_id, v_points, now())
    ON CONFLICT (user_id)
    DO UPDATE SET
      balance = token_allocations.balance + v_points,
      updated_at = now()
    RETURNING balance INTO v_new_balance;
  ELSE
    SELECT balance INTO v_new_balance
    FROM token_allocations
    WHERE user_id = v_user_id;
  END IF;

  -- Audit sensitive data write
  PERFORM public.write_audit_journal(
      p_action_type := 'create',
      p_area := 'studies',
      p_details := jsonb_build_object(
      'questionnaire_id', p_questionnaire_id,
      'study_registration_id', p_study_registration_id,
      'points_awarded', v_points
    ),
      p_entity_id := v_response_id::text,
      p_entity_type := 'questionnaire_response',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Member submitted questionnaire response',
      p_tags := ARRAY['phi','member','questionnaire'],
      p_user_id := v_user_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'response_id', v_response_id,
    'points_awarded', v_points,
    'new_balance', COALESCE(v_new_balance, 0)
  );
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.submit_questionnaire_response(p_questionnaire_id uuid, p_responses jsonb, p_study_registration_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_questionnaire_response(p_questionnaire_id uuid, p_responses jsonb, p_study_registration_id uuid) TO authenticated;
