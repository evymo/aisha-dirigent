-- Function: public.get_my_tracked_actions
-- Purpose: Universal read-model over a member's tracked actions ("the user did
--          / reacted to something") — ONE generic shape across the thematic
--          source tables (reminder completions, dose logs, health check-ins,
--          questionnaire responses). The domain tables stay as the concrete
--          implementations BEHIND this universal interface; callers depend only
--          on the abstract (action_type, occurred_at, source, payload) contract.
-- Access: authenticated member only (auth.uid()); SECURITY DEFINER + audit.
-- Note: read-only. The generic write path (record_tracked_action) and per-action
--       adherence rollups are intentionally separate follow-ups.

CREATE OR REPLACE FUNCTION public.get_my_tracked_actions(p_since timestamptz DEFAULT NULL::timestamptz, p_action_type text DEFAULT NULL::text, p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, action_type text, occurred_at timestamptz, reminder_id uuid, source text, source_id uuid, payload jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'member',
      p_details := jsonb_build_object('since', p_since, 'action_type', p_action_type, 'limit', p_limit),
      p_entity_id := NULL,
      p_entity_type := 'tracked_actions',
      p_severity := 'notice',
      p_summary := 'Member viewing tracked actions',
      p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT t.id, t.action_type, t.occurred_at, t.reminder_id, t.source, t.source_id, t.payload
  FROM (
    -- Reaction to a scheduled reminder. action_type carries the reminder's own
    -- type so callers can group without knowing the source table.
    SELECT
      rc.id,
      COALESCE(r.reminder_type, 'reminder') AS action_type,
      rc.completed_at AS occurred_at,
      rc.reminder_id,
      'reminder_completion'::text AS source,
      rc.id AS source_id,
      COALESCE(rc.quick_response, '{}'::jsonb)
        || jsonb_build_object('scheduled_for', rc.scheduled_for, 'points_awarded', rc.points_awarded) AS payload
    FROM reminder_completions rc
    LEFT JOIN user_reminders r ON r.id = rc.reminder_id
    WHERE rc.user_id = v_user_id

    UNION ALL

    -- Medication / product dose taken.
    SELECT
      dl.id,
      'dose'::text,
      COALESCE(dl.logged_at, dl.dosed_at, dl.created_at),
      NULL::uuid,
      'dosing_log'::text,
      dl.id,
      jsonb_build_object(
        'product_id', dl.product_id, 'dose_amount', dl.dose_amount,
        'dose_unit', dl.dose_unit, 'dose_count', dl.dose_count,
        'taken_with_food', dl.taken_with_food)
    FROM dosing_logs dl
    WHERE dl.user_id = v_user_id

    UNION ALL

    -- Self-reported check-in (pain/energy/mood/sleep + medication taken).
    SELECT
      hc.id,
      'check_in'::text,
      COALESCE(hc.created_at, hc.check_in_date::timestamptz),
      NULL::uuid,
      'health_check_in'::text,
      hc.id,
      jsonb_build_object(
        'pain_level', hc.pain_level, 'energy_level', hc.energy_level,
        'mood_level', hc.mood_level, 'sleep_quality', hc.sleep_quality,
        'took_medication', hc.took_medication, 'check_in_type', hc.check_in_type)
    FROM health_check_ins hc
    WHERE hc.user_id = v_user_id

    UNION ALL

    -- Completed questionnaire (payload is the summary, not the raw responses).
    SELECT
      qr.id,
      'questionnaire'::text,
      COALESCE(qr.completed_at, qr.created_at),
      NULL::uuid,
      'questionnaire_response'::text,
      qr.id,
      jsonb_build_object('questionnaire_id', qr.questionnaire_id, 'score', qr.score)
    FROM questionnaire_responses qr
    WHERE qr.user_id = v_user_id

    UNION ALL

    -- Ad-hoc generic action recorded via record_tracked_action (the write side
    -- of this abstraction; the only source whose action_type is caller-supplied).
    SELECT
      ta.id,
      ta.action_type,
      ta.occurred_at,
      ta.reminder_id,
      'tracked_action'::text,
      ta.id,
      ta.payload
    FROM tracked_actions ta
    WHERE ta.user_id = v_user_id
  ) t
  WHERE (p_action_type IS NULL OR t.action_type = p_action_type)
    AND (p_since IS NULL OR t.occurred_at >= p_since)
  ORDER BY t.occurred_at DESC NULLS LAST
  LIMIT GREATEST(COALESCE(p_limit, 100), 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_tracked_actions(timestamptz, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_tracked_actions(timestamptz, text, integer) TO authenticated;
