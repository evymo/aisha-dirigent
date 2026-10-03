-- Function: public.get_due_reminders_for_notification
-- Arguments: p_current_time text, p_current_dow integer, p_current_date date
-- Description: Returns reminders due for notification with FCM tokens.
-- Security: SECURITY DEFINER

CREATE OR REPLACE FUNCTION public.get_due_reminders_for_notification(
  p_current_time text,
  p_current_dow integer,
  p_current_date date
)
 RETURNS TABLE(
  user_id uuid,
  reminder_id uuid,
  reminder_title text,
  reminder_type text,
  points_per_completion integer,
  fcm_tokens text[]
)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH candidate_reminders AS (
    SELECT r.*
    FROM user_reminders r
    WHERE r.is_active = true
      AND r.notification_enabled = true
      AND (r.end_date IS NULL OR r.end_date >= p_current_date)
      AND r.time_of_day >= (p_current_time || ':00')::time
      AND r.time_of_day < (p_current_time || ':59')::time
      AND (
        r.frequency = 'daily'
        OR (
          (r.frequency = 'weekly' OR r.frequency = 'custom')
          AND p_current_dow = ANY(r.custom_frequency_days)
        )
        -- biweekly + monthly are accepted by create_user_reminder and scheduled by
        -- calculate_next_reminder_time, but were absent here, so their notifications
        -- never fired. Mirror the engine's "due today" test exactly.
        OR (
          r.frequency = 'biweekly'
          AND ((p_current_date - r.start_date) % 14) = 0
        )
        OR (
          r.frequency = 'monthly'
          AND EXTRACT(DAY FROM p_current_date) = EXTRACT(DAY FROM r.start_date)
        )
      )
  ),
  uncompleted AS (
    SELECT r.*
    FROM candidate_reminders r
    WHERE NOT EXISTS (
      SELECT 1
      FROM reminder_completions rc
      WHERE rc.reminder_id = r.id
        AND rc.completed_at >= (p_current_date::text || 'T00:00:00')::timestamptz
    )
  )
  SELECT
    u.user_id,
    u.id AS reminder_id,
    u.title AS reminder_title,
    u.reminder_type,
    u.points_per_completion,
    COALESCE(array_remove(array_agg(ms.fcm_token), NULL), ARRAY[]::text[]) AS fcm_tokens
  FROM uncompleted u
  LEFT JOIN mobile_sessions ms ON ms.user_id = u.user_id
  GROUP BY
    u.user_id,
    u.id,
    u.title,
    u.reminder_type,
    u.points_per_completion
  HAVING COUNT(ms.fcm_token) > 0
  ORDER BY reminder_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_due_reminders_for_notification(p_current_time text, p_current_dow integer, p_current_date date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_due_reminders_for_notification(p_current_time text, p_current_dow integer, p_current_date date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_due_reminders_for_notification(p_current_time text, p_current_dow integer, p_current_date date) TO service_role;
