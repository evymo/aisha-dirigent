-- Function: public.get_my_action_adherence
-- Purpose: Per-reminder adherence over a window — expected occurrences (derived
--          from the reminder's frequency) vs actual completions. Closes the loop
--          of the tracked_action surface: events ⋈ schedule. action_type carries
--          the reminder_type so the output speaks the universal vocabulary.
-- Access: authenticated member only (auth.uid()); SECURITY DEFINER + audit.

CREATE OR REPLACE FUNCTION public.get_my_action_adherence(p_window_days integer DEFAULT 30)
 RETURNS TABLE(reminder_id uuid, action_type text, title text, expected integer, actual integer, adherence_ratio numeric, window_start timestamptz, window_end timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_days integer := GREATEST(COALESCE(p_window_days, 30), 1);
  v_start timestamptz := now() - make_interval(days => GREATEST(COALESCE(p_window_days, 30), 1));
  v_end timestamptz := now();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'member',
      p_details := jsonb_build_object('window_days', v_days),
      p_entity_id := NULL,
      p_entity_type := 'action_adherence',
      p_severity := 'notice',
      p_summary := 'Member viewing action adherence',
      p_user_id := v_user_id
  );

  -- CTE column names are deliberately NOT expected/actual/title/reminder_id —
  -- those are OUT-param names and plpgsql would try to substitute them.
  RETURN QUERY
  WITH exp_cte AS (
    SELECT
      r.id AS rid,
      r.reminder_type AS rtype,
      r.title AS rtitle,
      CASE r.frequency
        WHEN 'daily'    THEN v_days
        WHEN 'weekly'   THEN CEIL(v_days::numeric / 7)::integer
        WHEN 'biweekly' THEN CEIL(v_days::numeric / 14)::integer
        WHEN 'monthly'  THEN CEIL(v_days::numeric / 30)::integer
        WHEN 'custom'   THEN GREATEST(CEIL(v_days::numeric / 7) * COALESCE(array_length(r.custom_frequency_days, 1), 0), 0)::integer
        ELSE 0
      END AS exp_count
    FROM user_reminders r
    WHERE r.user_id = v_user_id
      AND r.is_active = true
  ),
  act_cte AS (
    SELECT rc.reminder_id AS rid, COUNT(*)::integer AS act_count
    FROM reminder_completions rc
    WHERE rc.user_id = v_user_id
      AND rc.completed_at >= v_start
    GROUP BY rc.reminder_id
  )
  SELECT
    e.rid,
    e.rtype,
    e.rtitle,
    e.exp_count,
    COALESCE(a.act_count, 0),
    CASE WHEN e.exp_count > 0
      THEN LEAST(COALESCE(a.act_count, 0)::numeric / e.exp_count, 1.0)
      ELSE NULL
    END,
    v_start,
    v_end
  FROM exp_cte e
  LEFT JOIN act_cte a ON a.rid = e.rid
  ORDER BY e.rtitle;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_action_adherence(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_action_adherence(integer) TO authenticated;
