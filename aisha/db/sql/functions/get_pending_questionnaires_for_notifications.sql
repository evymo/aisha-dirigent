-- Function: public.get_pending_questionnaires_for_notifications
-- Arguments: p_frequencies text[], p_current_date date, p_current_timestamp timestamptz
-- Description: Returns pending questionnaires for reminder notifications with timezone-aware period cutoffs.
-- Security: SECURITY DEFINER

CREATE OR REPLACE FUNCTION public.get_pending_questionnaires_for_notifications(
  p_current_date date,
  p_current_timestamp timestamptz,
  p_frequencies text[]
)
 RETURNS TABLE(
  due_date date,
  frequency text,
  questionnaire_code text,
  questionnaire_id uuid,
  questionnaire_title text,
  study_registration_id uuid,
  user_id uuid
)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reference_ts timestamptz;
BEGIN
  v_reference_ts := COALESCE(
    p_current_timestamp,
    (p_current_date::text || ' 00:00:00+00')::timestamptz,
    now()
  );

  RETURN QUERY
  WITH candidates AS (
    SELECT
      se.user_id,
      se.id AS study_registration_id,
      sq.questionnaire_id,
      q.code AS questionnaire_code,
      q.name AS questionnaire_title,
      COALESCE(sq.frequency_type, sq.questionnaire_type) AS frequency,
      tz.user_timezone,
      timezone(tz.user_timezone, v_reference_ts) AS local_now
    FROM study_registrations se
    JOIN studies s ON s.id = se.study_id AND s.is_active = true
    JOIN study_questionnaires sq ON sq.study_id = s.id AND sq.is_active = true
    JOIN questionnaires q ON q.id = sq.questionnaire_id AND q.is_active = true
    LEFT JOIN notification_preferences np ON np.user_id = se.user_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        (
          SELECT tzn.name
          FROM pg_timezone_names tzn
          WHERE tzn.name = np.user_timezone
          LIMIT 1
        ),
        'UTC'
      ) AS user_timezone
    ) tz ON true
    WHERE se.status = 'active'
      AND COALESCE(sq.frequency_type, sq.questionnaire_type) = ANY(p_frequencies)
  ),
  with_cutoffs AS (
    SELECT
      c.user_id,
      c.study_registration_id,
      c.questionnaire_id,
      c.questionnaire_code,
      c.questionnaire_title,
      c.frequency,
      CASE
        WHEN c.frequency = 'monthly'
          THEN date_trunc('month', c.local_now) AT TIME ZONE c.user_timezone
        WHEN c.frequency = 'weekly'
          THEN date_trunc('week', c.local_now) AT TIME ZONE c.user_timezone
        ELSE date_trunc('day', c.local_now) AT TIME ZONE c.user_timezone
      END AS cutoff_at
    FROM candidates c
  )
  SELECT
    NULL::date AS due_date,
    c.frequency,
    c.questionnaire_code,
    c.questionnaire_id,
    c.questionnaire_title,
    c.study_registration_id,
    c.user_id
  FROM with_cutoffs c
  WHERE NOT EXISTS (
    SELECT 1
    FROM questionnaire_responses qr
    WHERE qr.user_id = c.user_id
      AND qr.questionnaire_id = c.questionnaire_id
      AND qr.completed_at >= c.cutoff_at
  )
  ORDER BY c.user_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_pending_questionnaires_for_notifications(DATE, TIMESTAMPTZ, TEXT[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pending_questionnaires_for_notifications(DATE, TIMESTAMPTZ, TEXT[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_pending_questionnaires_for_notifications(DATE, TIMESTAMPTZ, TEXT[]) TO service_role;
