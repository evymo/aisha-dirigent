/**
 * get_collaboration_preferences
 *
 * Returns collaboration preferences for the authenticated user.
 * If p_story_id is provided, returns story-specific overrides (if they exist),
 * otherwise returns global preferences or defaults.
 *
 * @param p_story_id - Optional UUID of a story for story-specific preferences
 * @returns jsonb - Collaboration preferences object with all settings
 */
CREATE OR REPLACE FUNCTION public.get_collaboration_preferences(
  p_story_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_global record;
  v_story record;
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not authenticated';
  END IF;

  SELECT
    cp.collab_mode,
    cp.notify_status_changes,
    cp.notify_blockers,
    cp.notify_architecture_decisions,
    cp.notify_code_events,
    cp.notify_participant_changes,
    cp.notify_ai_suggestions,
    cp.max_daily_cross_notifications,
    cp.min_severity,
    cp.quiet_start,
    cp.quiet_end,
    cp.timezone,
    cp.autopilot_max_actions_per_day,
    cp.autopilot_allowed_actions,
    cp.autopilot_risk_ceiling
  INTO v_global
  FROM public.collaboration_preferences cp
  WHERE cp.user_id = v_user_id
    AND cp.story_id IS NULL;

  IF v_global IS NULL THEN
    v_result := jsonb_build_object(
      'collab_mode', 'notify',
      'notify_status_changes', true,
      'notify_blockers', true,
      'notify_architecture_decisions', true,
      'notify_code_events', false,
      'notify_participant_changes', false,
      'notify_ai_suggestions', true,
      'max_daily_cross_notifications', 10,
      'min_severity', 'medium',
      'quiet_start', '22:00:00',
      'quiet_end', '07:00:00',
      'timezone', 'Europe/Prague',
      'autopilot_max_actions_per_day', 3,
      'autopilot_allowed_actions', ARRAY['suggest_link', 'create_thread', 'notify_overlap'],
      'autopilot_risk_ceiling', 'low',
      'is_default', true,
      'story_id', p_story_id
    );
  ELSE
    v_result := jsonb_build_object(
      'collab_mode', v_global.collab_mode,
      'notify_status_changes', v_global.notify_status_changes,
      'notify_blockers', v_global.notify_blockers,
      'notify_architecture_decisions', v_global.notify_architecture_decisions,
      'notify_code_events', v_global.notify_code_events,
      'notify_participant_changes', v_global.notify_participant_changes,
      'notify_ai_suggestions', v_global.notify_ai_suggestions,
      'max_daily_cross_notifications', v_global.max_daily_cross_notifications,
      'min_severity', v_global.min_severity,
      'quiet_start', v_global.quiet_start,
      'quiet_end', v_global.quiet_end,
      'timezone', v_global.timezone,
      'autopilot_max_actions_per_day', v_global.autopilot_max_actions_per_day,
      'autopilot_allowed_actions', v_global.autopilot_allowed_actions,
      'autopilot_risk_ceiling', v_global.autopilot_risk_ceiling,
      'is_default', false,
      'story_id', NULL::uuid
    );
  END IF;

  IF p_story_id IS NOT NULL THEN
    SELECT
      cp.collab_mode,
      cp.notify_status_changes,
      cp.notify_blockers,
      cp.notify_architecture_decisions,
      cp.notify_code_events,
      cp.notify_participant_changes,
      cp.notify_ai_suggestions,
      cp.max_daily_cross_notifications,
      cp.min_severity,
      cp.quiet_start,
      cp.quiet_end,
      cp.timezone,
      cp.autopilot_max_actions_per_day,
      cp.autopilot_allowed_actions,
      cp.autopilot_risk_ceiling
    INTO v_story
    FROM public.collaboration_preferences cp
    WHERE cp.user_id = v_user_id
      AND cp.story_id = p_story_id;

    IF v_story IS NOT NULL THEN
      v_result := jsonb_build_object(
        'collab_mode', v_story.collab_mode,
        'notify_status_changes', v_story.notify_status_changes,
        'notify_blockers', v_story.notify_blockers,
        'notify_architecture_decisions', v_story.notify_architecture_decisions,
        'notify_code_events', v_story.notify_code_events,
        'notify_participant_changes', v_story.notify_participant_changes,
        'notify_ai_suggestions', v_story.notify_ai_suggestions,
        'max_daily_cross_notifications', v_story.max_daily_cross_notifications,
        'min_severity', v_story.min_severity,
        'quiet_start', v_story.quiet_start,
        'quiet_end', v_story.quiet_end,
        'timezone', v_story.timezone,
        'autopilot_max_actions_per_day', v_story.autopilot_max_actions_per_day,
        'autopilot_allowed_actions', v_story.autopilot_allowed_actions,
        'autopilot_risk_ceiling', v_story.autopilot_risk_ceiling,
        'is_default', false,
        'story_id', p_story_id
      );
    END IF;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_collaboration_preferences(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_collaboration_preferences(uuid) TO authenticated;
