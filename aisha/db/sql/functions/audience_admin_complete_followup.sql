-- ============================================================================
-- Source of Truth: audience_admin_complete_followup
-- Description: Settles a follow-up. Since ADR-003 K2 a follow-up is a BEAT
--   (p_task_id = story_pulse_beats.id, the queue row key). A beat that came
--   from a workflow step is settled by COMPLETING THE STEP (the single write
--   path of work: complete_workflow_step → narration → goal re-evaluation → the
--   step↔beat joint closes the beat and opens the next). A beat with any other
--   source is closed directly. Legacy follow-ups created before K2 (beat with
--   source_type='ai_task', or the ai_tasks id itself) are still recognised and
--   settled, and their compatibility ai_tasks row is closed with them.
--   Returns true when THIS call settled it, false when it was already settled.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.audience_admin_complete_followup(
  p_task_id uuid,
  p_note text DEFAULT NULL,
  p_outcome text DEFAULT 'done'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_beat   public.story_pulse_beats%rowtype;
  v_res    jsonb;
  v_actor  uuid;
  v_updated int := 0;
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('done', 'cancelled') THEN
    RAISE EXCEPTION 'outcome must be done or cancelled' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_beat FROM public.story_pulse_beats b WHERE b.id = p_task_id;
  IF NOT FOUND THEN
    -- legacy: caller passed the ai_tasks id of a pre-K2 follow-up
    SELECT * INTO v_beat FROM public.story_pulse_beats b
    WHERE b.source_type = 'ai_task' AND b.source_id = p_task_id
    ORDER BY (b.status = 'open') DESC, b.created_at DESC
    LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Follow-up not found' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_beat.status <> 'open' THEN
    RETURN false;  -- already settled (idempotent)
  END IF;

  v_actor := CASE WHEN v_beat.subject_type = 'actor' THEN v_beat.subject_id ELSE NULL END;

  IF v_beat.source_type = 'workflow_step' THEN
    -- Práce se uzavírá krokem; kloub v complete_workflow_step uzavře takt.
    v_res := public.complete_workflow_step(
      v_beat.source_id,
      jsonb_build_object('outcome', p_outcome, 'note', p_note),
      p_note,
      false,
      now());
    IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN
      RAISE EXCEPTION 'follow-up step not completed: %', COALESCE(v_res->>'error', 'unknown');
    END IF;
    -- Kloub běží jako chráněný vedlejší účinek; kdyby selhal, takt by zůstal
    -- otevřený a tahle funkce by lhala, že je hotovo. Proto se to dohlíží tady.
    IF EXISTS (SELECT 1 FROM public.story_pulse_beats b WHERE b.id = v_beat.id AND b.status = 'open') THEN
      RAISE EXCEPTION 'step completed but beat % stayed open (joint failed — see audit_journal workflow.beat_joint_failed)', v_beat.id;
    END IF;
    v_updated := 1;
  ELSE
    PERFORM public.close_pulse_beat_audited(
      p_beat_id := v_beat.id,
      p_outcome := p_outcome,
      p_content := p_note);
    v_updated := 1;
  END IF;

  -- legacy compatibility row (pre-K2 follow-ups)
  IF v_beat.source_type = 'ai_task' AND v_beat.source_id IS NOT NULL THEN
    UPDATE public.ai_tasks
    SET status = CASE WHEN p_outcome = 'cancelled' THEN 'cancelled' ELSE 'done' END,
        completed_at = now(),
        updated_at = now(),
        result = COALESCE(result, '{}'::jsonb)
                   || jsonb_build_object('outcome', p_outcome, 'note', p_note, 'beat_id', v_beat.id)
    WHERE id = v_beat.source_id
      AND task_type = 'follow_up'
      AND status NOT IN ('done', 'cancelled');
  END IF;

  PERFORM public.audience_log_event(
    'complete_followup',
    'audience_admin_complete_followup',
    'story_pulse_beat',
    v_beat.id,
    format('Completed follow-up (%s) for %s %s', p_outcome, v_beat.subject_type, v_beat.subject_id),
    jsonb_build_object('actor_id', v_actor, 'subject_type', v_beat.subject_type,
                       'subject_id', v_beat.subject_id, 'outcome', p_outcome,
                       'beat_id', v_beat.id, 'source_type', v_beat.source_type,
                       'source_id', v_beat.source_id, 'note', p_note)
  );
  RETURN v_updated > 0;
END;
$function$
;
-- Permissions
REVOKE ALL ON FUNCTION public.audience_admin_complete_followup(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audience_admin_complete_followup(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.audience_admin_complete_followup(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.audience_admin_complete_followup(uuid, text, text) TO authenticator;
GRANT EXECUTE ON FUNCTION public.audience_admin_complete_followup(uuid, text, text) TO service_role;
