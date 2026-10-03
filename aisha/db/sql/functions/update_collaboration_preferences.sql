/**
 * update_collaboration_preferences
 *
 * Creates or updates collaboration preferences for the authenticated user.
 * Supports both global (p_story_id = NULL) and story-specific overrides.
 * Validates collab_mode, min_severity, and autopilot_risk_ceiling.
 *
 * For story-specific preferences: uses UPSERT on (user_id, story_id) unique constraint.
 * For global preferences (story_id IS NULL): uses explicit check + UPDATE/INSERT
 * because PostgreSQL UNIQUE constraints treat NULL != NULL, so ON CONFLICT never
 * matches for NULL story_id. A partial unique index enforces one global row per user.
 *
 * Logs the action to audit_journal.
 *
 * @param p_preferences - JSONB object with preference fields to set
 * @param p_story_id - Optional UUID of a story for story-specific preferences
 * @returns jsonb - Result with preference id, story_id, and update flag
 */
CREATE OR REPLACE FUNCTION public.update_collaboration_preferences(
  p_preferences jsonb,
  p_story_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_pref_id uuid;
  v_collab_mode text;
  v_allowed_modes text[] := ARRAY['silent', 'digest', 'notify', 'interactive', 'autopilot'];
  v_allowed_severities text[] := ARRAY['low', 'medium', 'high', 'critical'];
  v_allowed_risk text[] := ARRAY['low', 'medium'];
  v_existing_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not authenticated' USING ERRCODE = '22023';
  END IF;

  v_collab_mode := p_preferences->>'collab_mode';
  IF v_collab_mode IS NOT NULL AND NOT (v_collab_mode = ANY(v_allowed_modes)) THEN
    RAISE EXCEPTION 'Invalid collab_mode: %. Allowed: %', v_collab_mode, v_allowed_modes USING ERRCODE = '22023';
  END IF;

  IF p_preferences->>'min_severity' IS NOT NULL
    AND NOT ((p_preferences->>'min_severity') = ANY(v_allowed_severities)) THEN
    RAISE EXCEPTION 'Invalid min_severity: %', p_preferences->>'min_severity' USING ERRCODE = '22023';
  END IF;

  IF p_preferences->>'autopilot_risk_ceiling' IS NOT NULL
    AND NOT ((p_preferences->>'autopilot_risk_ceiling') = ANY(v_allowed_risk)) THEN
    RAISE EXCEPTION 'Invalid autopilot_risk_ceiling: %', p_preferences->>'autopilot_risk_ceiling' USING ERRCODE = '22023';
  END IF;

  IF p_story_id IS NULL THEN
    -- Global preferences: ON CONFLICT (user_id, story_id) does NOT work
    -- when story_id IS NULL because NULL != NULL in PostgreSQL.
    -- Use explicit check + UPDATE/INSERT instead.
    SELECT id INTO v_existing_id
    FROM public.collaboration_preferences
    WHERE user_id = v_user_id AND story_id IS NULL;

    IF v_existing_id IS NOT NULL THEN
      UPDATE public.collaboration_preferences SET
        collab_mode = COALESCE(v_collab_mode, collab_mode),
        notify_status_changes = COALESCE((p_preferences->>'notify_status_changes')::boolean, notify_status_changes),
        notify_blockers = COALESCE((p_preferences->>'notify_blockers')::boolean, notify_blockers),
        notify_architecture_decisions = COALESCE((p_preferences->>'notify_architecture_decisions')::boolean, notify_architecture_decisions),
        notify_code_events = COALESCE((p_preferences->>'notify_code_events')::boolean, notify_code_events),
        notify_participant_changes = COALESCE((p_preferences->>'notify_participant_changes')::boolean, notify_participant_changes),
        notify_ai_suggestions = COALESCE((p_preferences->>'notify_ai_suggestions')::boolean, notify_ai_suggestions),
        max_daily_cross_notifications = COALESCE((p_preferences->>'max_daily_cross_notifications')::int, max_daily_cross_notifications),
        min_severity = COALESCE(p_preferences->>'min_severity', min_severity),
        quiet_start = COALESCE((p_preferences->>'quiet_start')::time, quiet_start),
        quiet_end = COALESCE((p_preferences->>'quiet_end')::time, quiet_end),
        timezone = COALESCE(p_preferences->>'timezone', timezone),
        autopilot_max_actions_per_day = COALESCE((p_preferences->>'autopilot_max_actions_per_day')::int, autopilot_max_actions_per_day),
        autopilot_allowed_actions = COALESCE(
          (SELECT array_agg(x)::text[] FROM jsonb_array_elements_text(p_preferences->'autopilot_allowed_actions') x),
          autopilot_allowed_actions
        ),
        autopilot_risk_ceiling = COALESCE(p_preferences->>'autopilot_risk_ceiling', autopilot_risk_ceiling),
        updated_at = now()
      WHERE id = v_existing_id
      RETURNING id INTO v_pref_id;
    ELSE
      INSERT INTO public.collaboration_preferences (user_id, story_id,
        collab_mode,
        notify_status_changes, notify_blockers, notify_architecture_decisions,
        notify_code_events, notify_participant_changes, notify_ai_suggestions,
        max_daily_cross_notifications, min_severity,
        quiet_start, quiet_end, timezone,
        autopilot_max_actions_per_day, autopilot_allowed_actions, autopilot_risk_ceiling
      )
      VALUES (
        v_user_id,
        NULL,
        COALESCE(v_collab_mode, 'notify'),
        COALESCE((p_preferences->>'notify_status_changes')::boolean, true),
        COALESCE((p_preferences->>'notify_blockers')::boolean, true),
        COALESCE((p_preferences->>'notify_architecture_decisions')::boolean, true),
        COALESCE((p_preferences->>'notify_code_events')::boolean, false),
        COALESCE((p_preferences->>'notify_participant_changes')::boolean, false),
        COALESCE((p_preferences->>'notify_ai_suggestions')::boolean, true),
        COALESCE((p_preferences->>'max_daily_cross_notifications')::int, 10),
        COALESCE(p_preferences->>'min_severity', 'medium'),
        COALESCE((p_preferences->>'quiet_start')::time, '22:00:00'::time),
        COALESCE((p_preferences->>'quiet_end')::time, '07:00:00'::time),
        COALESCE(p_preferences->>'timezone', 'Europe/Prague'),
        COALESCE((p_preferences->>'autopilot_max_actions_per_day')::int, 3),
        COALESCE(
          (SELECT array_agg(x)::text[] FROM jsonb_array_elements_text(p_preferences->'autopilot_allowed_actions') x),
          '{suggest_link,create_thread,notify_overlap}'::text[]
        ),
        COALESCE(p_preferences->>'autopilot_risk_ceiling', 'low')
      )
      RETURNING id INTO v_pref_id;
    END IF;
  ELSE
    -- Story-specific preferences: ON CONFLICT works fine because
    -- both user_id and story_id are NOT NULL.
    INSERT INTO public.collaboration_preferences (user_id, story_id,
      collab_mode,
      notify_status_changes, notify_blockers, notify_architecture_decisions,
      notify_code_events, notify_participant_changes, notify_ai_suggestions,
      max_daily_cross_notifications, min_severity,
      quiet_start, quiet_end, timezone,
      autopilot_max_actions_per_day, autopilot_allowed_actions, autopilot_risk_ceiling
    )
    VALUES (
      v_user_id,
      p_story_id,
      COALESCE(v_collab_mode, 'notify'),
      COALESCE((p_preferences->>'notify_status_changes')::boolean, true),
      COALESCE((p_preferences->>'notify_blockers')::boolean, true),
      COALESCE((p_preferences->>'notify_architecture_decisions')::boolean, true),
      COALESCE((p_preferences->>'notify_code_events')::boolean, false),
      COALESCE((p_preferences->>'notify_participant_changes')::boolean, false),
      COALESCE((p_preferences->>'notify_ai_suggestions')::boolean, true),
      COALESCE((p_preferences->>'max_daily_cross_notifications')::int, 10),
      COALESCE(p_preferences->>'min_severity', 'medium'),
      COALESCE((p_preferences->>'quiet_start')::time, '22:00:00'::time),
      COALESCE((p_preferences->>'quiet_end')::time, '07:00:00'::time),
      COALESCE(p_preferences->>'timezone', 'Europe/Prague'),
      COALESCE((p_preferences->>'autopilot_max_actions_per_day')::int, 3),
      COALESCE(
        (SELECT array_agg(x)::text[] FROM jsonb_array_elements_text(p_preferences->'autopilot_allowed_actions') x),
        '{suggest_link,create_thread,notify_overlap}'::text[]
      ),
      COALESCE(p_preferences->>'autopilot_risk_ceiling', 'low')
    )
    ON CONFLICT (user_id, story_id) DO UPDATE SET
      collab_mode = COALESCE(EXCLUDED.collab_mode, collaboration_preferences.collab_mode),
      notify_status_changes = COALESCE(EXCLUDED.notify_status_changes, collaboration_preferences.notify_status_changes),
      notify_blockers = COALESCE(EXCLUDED.notify_blockers, collaboration_preferences.notify_blockers),
      notify_architecture_decisions = COALESCE(EXCLUDED.notify_architecture_decisions, collaboration_preferences.notify_architecture_decisions),
      notify_code_events = COALESCE(EXCLUDED.notify_code_events, collaboration_preferences.notify_code_events),
      notify_participant_changes = COALESCE(EXCLUDED.notify_participant_changes, collaboration_preferences.notify_participant_changes),
      notify_ai_suggestions = COALESCE(EXCLUDED.notify_ai_suggestions, collaboration_preferences.notify_ai_suggestions),
      max_daily_cross_notifications = COALESCE(EXCLUDED.max_daily_cross_notifications, collaboration_preferences.max_daily_cross_notifications),
      min_severity = COALESCE(EXCLUDED.min_severity, collaboration_preferences.min_severity),
      quiet_start = COALESCE(EXCLUDED.quiet_start, collaboration_preferences.quiet_start),
      quiet_end = COALESCE(EXCLUDED.quiet_end, collaboration_preferences.quiet_end),
      timezone = COALESCE(EXCLUDED.timezone, collaboration_preferences.timezone),
      autopilot_max_actions_per_day = COALESCE(EXCLUDED.autopilot_max_actions_per_day, collaboration_preferences.autopilot_max_actions_per_day),
      autopilot_allowed_actions = COALESCE(EXCLUDED.autopilot_allowed_actions, collaboration_preferences.autopilot_allowed_actions),
      autopilot_risk_ceiling = COALESCE(EXCLUDED.autopilot_risk_ceiling, collaboration_preferences.autopilot_risk_ceiling),
      updated_at = now()
    RETURNING id INTO v_pref_id;
  END IF;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'COLLAB_PREFERENCES_UPDATED',
    jsonb_build_object(
      'area', 'collaboration',
      'severity', 'info',
      'preference_id', v_pref_id,
      'story_id', p_story_id,
      'collab_mode', COALESCE(v_collab_mode, 'notify')
    )
  );

  RETURN jsonb_build_object(
    'id', v_pref_id,
    'story_id', p_story_id,
    'updated', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_collaboration_preferences(jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_collaboration_preferences(jsonb, uuid) TO authenticated;
