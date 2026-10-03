-- Function: public.close_pulse_beat_audited
-- Arguments: p_beat_id uuid, p_outcome text, p_content text, p_metadata jsonb
-- Description: Closes a BEAT with a CONFIRMATION — the third stroke of the
--              pulse. The confirmation is a typed record on the subject's
--              timeline, and the beat points back at it (closing_entry_id), so
--              "what was owed" and "what proves it was done" are one link apart.
-- Security: SECURITY DEFINER. Who may close: operators, the person the beat is
--           addressed to, or the subject themselves (an actor confirming their
--           own dose/practice). The entry type is confined to the pulse
--           namespace so a caller cannot mint arbitrary typed records through
--           this door.

CREATE OR REPLACE FUNCTION public.close_pulse_beat_audited(
  p_beat_id uuid,
  p_outcome text DEFAULT 'done',
  p_content text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_is_service boolean := (auth.role() = 'service_role');
  v_beat public.story_pulse_beats%ROWTYPE;
  v_entry_id uuid;
  v_entry_type text;
BEGIN
  IF v_caller_id IS NULL AND NOT v_is_service THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('done', 'cancelled') THEN
    RAISE EXCEPTION 'outcome must be done or cancelled' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_beat FROM public.story_pulse_beats WHERE id = p_beat_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Beat not found' USING ERRCODE = '22023';
  END IF;
  IF v_beat.status <> 'open' THEN
    -- Already settled: report the existing proof rather than closing twice.
    RETURN v_beat.closing_entry_id;
  END IF;

  IF NOT (
    v_is_service
    OR public.is_admin_or_staff()
    OR v_beat.assigned_to_user_id = v_caller_id
    OR (v_beat.subject_type = 'actor' AND v_beat.subject_id = v_caller_id)
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  v_entry_type := CASE WHEN p_outcome = 'cancelled' THEN 'pulse_beat_cancelled' ELSE 'pulse_beat_closed' END;

  v_entry_id := public.append_subject_entry_service(
    p_subject_type := v_beat.subject_type,
    p_subject_id   := v_beat.subject_id,
    p_entry_type   := v_entry_type,
    p_content      := p_content,
    p_metadata     := jsonb_build_object(
      'beat_id', v_beat.id,
      'beat_type', v_beat.beat_type,
      'outcome', p_outcome,
      'due_at', v_beat.due_at,
      'source_type', v_beat.source_type,
      'source_id', v_beat.source_id
    ) || COALESCE(p_metadata, '{}'::jsonb),
    p_created_by   := v_caller_id,
    p_story_id     := CASE WHEN v_beat.subject_type = 'story' THEN v_beat.subject_id ELSE NULL END,
    p_is_internal  := true,
    p_occurred_at  := now()
  );

  UPDATE public.story_pulse_beats
  SET status = CASE WHEN p_outcome = 'cancelled' THEN 'cancelled' ELSE 'done' END,
      closed_at = now(),
      closed_by = v_caller_id,
      closing_entry_id = v_entry_id
  WHERE id = v_beat.id;

  PERFORM public.write_audit_journal(
    p_action_type := 'update'::public.journal_action_type,
    p_area        := 'system'::public.journal_area,
    p_details     := jsonb_build_object(
      'beat_id', v_beat.id,
      'beat_type', v_beat.beat_type,
      'outcome', p_outcome,
      'subject_type', v_beat.subject_type,
      'subject_user_id', CASE WHEN v_beat.subject_type = 'actor' THEN v_beat.subject_id ELSE NULL END,
      'entry_id', v_entry_id
    ),
    p_entity_id   := v_beat.id::text,
    p_entity_type := 'story_pulse_beats',
    p_severity    := 'info'::public.journal_severity,
    p_summary     := format('Pulse beat %s (%s)', p_outcome, v_beat.beat_type),
    p_user_id     := v_caller_id
  );

  RETURN v_entry_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.close_pulse_beat_audited(uuid, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.close_pulse_beat_audited(uuid, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.close_pulse_beat_audited(uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_pulse_beat_audited(uuid, text, text, jsonb) TO service_role;
