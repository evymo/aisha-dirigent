-- Function: public.get_study_questionnaires_mobile
-- Arguments: p_study_registration_id uuid, p_locale text
-- Description: Returns study questionnaires for the authenticated user with status and scheduling.
-- Security: SECURITY DEFINER (sensitive data)

CREATE OR REPLACE FUNCTION public.get_study_questionnaires_mobile(
  p_locale text DEFAULT 'en'::text,
  p_study_registration_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Audit log for sensitive data access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'member',
      p_details := jsonb_build_object('registration_id', p_study_registration_id),
      p_entity_id := NULL,
      p_entity_type := 'questionnaires',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Member viewing study questionnaires',
      p_tags := ARRAY['phi','member','questionnaire'],
      p_user_id := v_user_id
  );

  PERFORM enforce_rate_limit('get_study_questionnaires_mobile', 60000, 20);

  WITH user_registrations AS (
    SELECT
      se.id AS registration_id,
      se.study_id,
      se.enrolled_at::date AS enrolled_date,
      s.name AS study_name
    FROM study_registrations se
    JOIN studies s ON se.study_id = s.id
    WHERE se.user_id = v_user_id
      -- Include pending/screening - users should fill questionnaires as part of qualification
      AND se.status::text IN ('pending', 'screening', 'enrolled', 'active')
      AND (p_study_registration_id IS NULL OR se.id = p_study_registration_id)
  ),
  study_configs AS (
    SELECT
      sq.id AS study_questionnaire_id,
      sq.study_id,
      sq.questionnaire_id,
      sq.questionnaire_type,
      sq.title_key,
      sq.description_key,
      COALESCE(sq.frequency_type, sq.questionnaire_type) AS frequency_type,
      sq.frequency_days,
      sq.starts_after_days,
      sq.ends_after_days,
      sq.display_order,
      sq.is_required,
      sq.token_reward,
      q.code AS questionnaire_code,
      q.name AS questionnaire_name,
      q.name_key AS questionnaire_name_key,
      q.description_key AS questionnaire_description_key,
      q.version AS questionnaire_version,
      q.token_reward AS questionnaire_token_reward,
      q.points_reward AS questionnaire_points_reward
    FROM study_questionnaires sq
    JOIN questionnaires q ON q.id = sq.questionnaire_id AND q.is_active = true
    WHERE sq.is_active = true
  ),
  responses AS (
    SELECT
      qr.questionnaire_id,
      qr.study_registration_id,
      MAX(qr.completed_at) AS last_completed_at
    FROM questionnaire_responses qr
    WHERE qr.user_id = v_user_id
    GROUP BY qr.questionnaire_id, qr.study_registration_id
  ),
  hydrated AS (
    SELECT
      ue.registration_id,
      ue.study_id,
      ue.study_name,
      sc.study_questionnaire_id,
      sc.questionnaire_id,
      sc.questionnaire_code,
      sc.questionnaire_type,
      sc.display_order,
      sc.is_required,
      sc.frequency_type,
      sc.frequency_days,
      sc.starts_after_days,
      sc.ends_after_days,
      sc.questionnaire_version,
      COALESCE(sc.token_reward, sc.questionnaire_token_reward, sc.questionnaire_points_reward, 0) AS points_reward,
      r.last_completed_at,
      ue.enrolled_date,
      COALESCE(
        (SELECT t.value FROM translations t WHERE t.key = sc.title_key AND t.locale = p_locale AND t.namespace = 'questionnaires' LIMIT 1),
        (SELECT t.value FROM translations t WHERE t.key = sc.title_key AND t.locale = 'en' AND t.namespace = 'questionnaires' LIMIT 1),
        (SELECT t.value FROM translations t WHERE t.key = sc.questionnaire_name_key AND t.locale = p_locale AND t.namespace = 'questionnaires' LIMIT 1),
        (SELECT t.value FROM translations t WHERE t.key = sc.questionnaire_name_key AND t.locale = 'en' AND t.namespace = 'questionnaires' LIMIT 1),
        sc.questionnaire_name
      ) AS title,
      COALESCE(
        (SELECT t.value FROM translations t WHERE t.key = sc.description_key AND t.locale = p_locale AND t.namespace = 'questionnaires' LIMIT 1),
        (SELECT t.value FROM translations t WHERE t.key = sc.description_key AND t.locale = 'en' AND t.namespace = 'questionnaires' LIMIT 1),
        (SELECT t.value FROM translations t WHERE t.key = sc.questionnaire_description_key AND t.locale = p_locale AND t.namespace = 'questionnaires' LIMIT 1),
        (SELECT t.value FROM translations t WHERE t.key = sc.questionnaire_description_key AND t.locale = 'en' AND t.namespace = 'questionnaires' LIMIT 1),
        ''
      ) AS description
    FROM user_registrations ue
    JOIN study_configs sc ON sc.study_id = ue.study_id
    LEFT JOIN responses r
      ON r.questionnaire_id = sc.questionnaire_id
      AND r.study_registration_id = ue.registration_id
  ),
  scheduled AS (
    SELECT
      h.*,
      (h.enrolled_date + COALESCE(h.starts_after_days, 0))::date AS available_from,
      CASE
        WHEN h.ends_after_days IS NULL THEN NULL
        ELSE (h.enrolled_date + h.ends_after_days)::date
      END AS available_until,
      CASE
        WHEN h.frequency_days IS NOT NULL THEN h.frequency_days
        WHEN h.frequency_type = 'daily' THEN 1
        WHEN h.frequency_type = 'weekly' THEN 7
        WHEN h.frequency_type = 'monthly' THEN 30
        ELSE NULL
      END AS effective_frequency_days
    FROM hydrated h
  ),
  final AS (
    SELECT
      s.*,
      CASE
        WHEN current_date < s.available_from THEN 'pending'
        WHEN s.available_until IS NOT NULL AND current_date > s.available_until THEN 'expired'
        WHEN s.last_completed_at IS NULL THEN 'pending'
        WHEN s.effective_frequency_days IS NULL THEN 'completed'
        WHEN s.last_completed_at::date >= current_date - make_interval(days => s.effective_frequency_days) THEN 'completed'
        ELSE 'pending'
      END AS status,
      CASE
        WHEN current_date < s.available_from THEN false
        WHEN s.available_until IS NOT NULL AND current_date > s.available_until THEN false
        WHEN s.effective_frequency_days IS NULL THEN s.last_completed_at IS NULL
        WHEN s.last_completed_at IS NULL THEN true
        WHEN s.last_completed_at::date < current_date - make_interval(days => s.effective_frequency_days) THEN true
        ELSE false
      END AS can_submit,
      CASE
        WHEN current_date < s.available_from THEN s.available_from
        WHEN s.available_until IS NOT NULL AND current_date > s.available_until THEN s.available_until
        WHEN s.effective_frequency_days IS NULL THEN s.available_from
        WHEN s.last_completed_at IS NULL THEN current_date
        ELSE (s.last_completed_at::date + make_interval(days => s.effective_frequency_days))::date
      END AS due_date
    FROM scheduled s
  )
  SELECT jsonb_build_object(
    'questionnaires', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', f.study_questionnaire_id,
          'study_id', f.study_id,
          'study_registration_id', f.registration_id,
          'study_name', f.study_name,
          'questionnaire_id', f.questionnaire_id,
          'questionnaire_code', f.questionnaire_code,
          'questionnaire_type', f.questionnaire_type,
          'title', f.title,
          'description', f.description,
          'is_required', f.is_required,
          'display_order', f.display_order,
          'frequency_days', f.frequency_days,
          'frequency_type', f.frequency_type,
          'estimated_duration_minutes', NULL,
          'points_reward', f.points_reward,
          'status', f.status,
          'completed_at', f.last_completed_at,
          'can_submit', f.can_submit,
          'due_date', f.due_date
        )
        ORDER BY f.study_id, f.display_order
      ),
      '[]'::JSONB
    ),
    'total_pending', COALESCE(SUM(CASE WHEN f.status = 'pending' THEN 1 ELSE 0 END), 0),
    'total_completed', COALESCE(SUM(CASE WHEN f.status = 'completed' THEN 1 ELSE 0 END), 0)
  ) INTO v_result
  FROM final f;

  RETURN v_result;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_study_questionnaires_mobile(p_locale text, p_study_registration_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_study_questionnaires_mobile(p_locale text, p_study_registration_id uuid) TO authenticated;
