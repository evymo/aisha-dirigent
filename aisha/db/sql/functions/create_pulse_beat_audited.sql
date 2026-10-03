-- Function: public.create_pulse_beat_audited
-- Arguments: p_subject_type text, p_subject_id uuid, p_beat_type text, p_due_at timestamptz,
--            p_assigned_to_user_id uuid, p_source_type text, p_source_id uuid,
--            p_note text, p_metadata jsonb
-- Description: Opens a BEAT — "subject X owes an action of type T by time D,
--              owed by person P" — and records the opening as a typed record on
--              the subject's timeline. Idempotent per (subject, kind, deadline,
--              originating regime): re-running a regime generator re-uses the
--              open beat instead of stacking duplicates.
-- Security: SECURITY DEFINER. Authorization is SUBJECT-side: operators may open
--           a beat on any twin, a member only on their own. Self-ASSIGNMENT is
--           deliberately NOT a source of authority — gating on "the addressee is
--           me" would let any caller write onto a stranger's twin simply by
--           addressing the beat to themselves (the caller-controlled-id class
--           closed in #797).

CREATE OR REPLACE FUNCTION public.create_pulse_beat_audited(
  p_subject_type text,
  p_subject_id uuid,
  p_beat_type text,
  p_due_at timestamptz,
  p_assigned_to_user_id uuid DEFAULT NULL,
  p_source_type text DEFAULT NULL,
  p_source_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL,
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
  v_beat_id uuid;
  v_entry_id uuid;
BEGIN
  IF v_caller_id IS NULL AND NOT v_is_service THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_subject_type IS NULL OR btrim(p_subject_type) = '' THEN
    RAISE EXCEPTION 'subject_type is required' USING ERRCODE = '22023';
  END IF;
  IF p_subject_id IS NULL THEN
    RAISE EXCEPTION 'subject_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_beat_type IS NULL OR btrim(p_beat_type) = '' THEN
    RAISE EXCEPTION 'beat_type is required' USING ERRCODE = '22023';
  END IF;
  IF p_due_at IS NULL THEN
    RAISE EXCEPTION 'due_at is required' USING ERRCODE = '22023';
  END IF;

  -- Authorization binds the SUBJECT, never the addressee.
  IF NOT (
    v_is_service
    OR public.is_admin_or_staff()
    OR (p_subject_type = 'actor' AND p_subject_id = v_caller_id)
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- Existence of the subject is checked per kind. The polymorphic axis carries
  -- no FK, so an unchecked subject_id would let a beat point at nothing and
  -- surface later as a queue row nobody can resolve.
  CASE p_subject_type
    WHEN 'actor' THEN
      IF NOT EXISTS (SELECT 1 FROM aisha_auth.users u WHERE u.id = p_subject_id) THEN
        RAISE EXCEPTION 'Subject not found: actor %', p_subject_id USING ERRCODE = '22023';
      END IF;
    WHEN 'story' THEN
      IF NOT EXISTS (SELECT 1 FROM public.partner_stories ps WHERE ps.id = p_subject_id) THEN
        RAISE EXCEPTION 'Subject not found: story %', p_subject_id USING ERRCODE = '22023';
      END IF;
    ELSE
      -- Open axis by design (equipment, batch, … are implementation-seeded
      -- kinds). Operators/services only — a member may address their own twin
      -- and nothing else, which the gate above already enforces.
      NULL;
  END CASE;

  INSERT INTO public.story_pulse_beats (
    subject_type, subject_id, beat_type, status, due_at,
    assigned_to_user_id, source_type, source_id, note, metadata, created_by
  ) VALUES (
    p_subject_type, p_subject_id, p_beat_type, 'open', p_due_at,
    p_assigned_to_user_id, p_source_type, p_source_id, p_note,
    COALESCE(p_metadata, '{}'::jsonb), v_caller_id
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_beat_id;

  -- Idempotence: the partial UNIQUE index already holds this exact open slot.
  IF v_beat_id IS NULL THEN
    SELECT b.id INTO v_beat_id
    FROM public.story_pulse_beats b
    WHERE b.status = 'open'
      AND b.subject_type = p_subject_type
      AND b.subject_id = p_subject_id
      AND b.beat_type = p_beat_type
      AND b.due_at = p_due_at
      AND COALESCE(b.source_type, '') = COALESCE(p_source_type, '')
      AND COALESCE(b.source_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = COALESCE(p_source_id, '00000000-0000-0000-0000-000000000000'::uuid)
    LIMIT 1;
    RETURN v_beat_id;
  END IF;

  -- The opening is itself a typed record on the twin's timeline. occurred_at is
  -- NOW (when the beat was opened) and never the deadline: occurred_at means
  -- "when it happened" everywhere else in this schema, and back/forward-dating
  -- it would scramble the ordering of the whole axis.
  v_entry_id := public.append_subject_entry_service(
    p_subject_type := p_subject_type,
    p_subject_id   := p_subject_id,
    p_entry_type   := 'pulse_beat_opened',
    p_content      := p_note,
    p_metadata     := jsonb_build_object(
      'beat_id', v_beat_id,
      'beat_type', p_beat_type,
      'due_at', p_due_at,
      'assigned_to_user_id', p_assigned_to_user_id,
      'source_type', p_source_type,
      'source_id', p_source_id
    ),
    p_created_by   := v_caller_id,
    p_story_id     := CASE WHEN p_subject_type = 'story' THEN p_subject_id ELSE NULL END,
    p_is_internal  := true,
    p_occurred_at  := now()
  );

  PERFORM public.write_audit_journal(
    p_action_type := 'create'::public.journal_action_type,
    p_area        := 'system'::public.journal_area,
    p_details     := jsonb_build_object(
      'beat_id', v_beat_id,
      'subject_type', p_subject_type,
      'subject_user_id', CASE WHEN p_subject_type = 'actor' THEN p_subject_id ELSE NULL END,
      'beat_type', p_beat_type,
      'due_at', p_due_at,
      'entry_id', v_entry_id
    ),
    p_entity_id   := v_beat_id::text,
    p_entity_type := 'story_pulse_beats',
    p_severity    := 'info'::public.journal_severity,
    p_summary     := format('Pulse beat opened (%s)', p_beat_type),
    p_user_id     := v_caller_id
  );

  RETURN v_beat_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_pulse_beat_audited(text, uuid, text, timestamptz, uuid, text, uuid, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_pulse_beat_audited(text, uuid, text, timestamptz, uuid, text, uuid, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_pulse_beat_audited(text, uuid, text, timestamptz, uuid, text, uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_pulse_beat_audited(text, uuid, text, timestamptz, uuid, text, uuid, text, jsonb) TO service_role;
