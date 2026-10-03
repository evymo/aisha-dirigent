-- ============================================================================
-- Source of Truth: audience_admin_log_touch
-- Popis: Operátor zaznamená DOTEK se subjektem (hovor, schůzka, poznámka, …)
--   jako typový záznam na jeho ose (ADR-003: každá práce s aktérem = záznam
--   ve story). Subjekt je dvojče, účet nebo story; typ záznamu přichází z
--   katalogu instance (entry_type_definitions) — tady se ověřuje jen tvar.
--   Volitelný termín navazujícího kroku: má-li subjekt účet, založí se
--   follow-up jako BĚH (K2, audience_admin_create_followup); jinak takt na
--   dvojčeti (create_pulse_beat_audited). Vrací id záznamu.
-- Autorizace: is_admin_or_staff — operátorská obálka nad
-- append_subject_entry_service (privilegovaný zapisovač osy).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.audience_admin_log_touch(
  p_subject_type  text,
  p_subject_id    uuid,
  p_entry_type    text,
  p_content       text,
  p_occurred_at   timestamptz DEFAULT NULL,
  p_follow_up_at  timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_entry  uuid;
  v_user   uuid;
  v_beat   uuid;
  v_story  uuid;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  IF p_subject_type IS NULL OR p_subject_type NOT IN ('twin', 'actor', 'story') THEN
    RAISE EXCEPTION 'subject_type must be twin, actor or story' USING ERRCODE = '22023';
  END IF;
  IF p_subject_id IS NULL THEN
    RAISE EXCEPTION 'subject_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_entry_type IS NULL OR p_entry_type !~ '^[a-z][a-z0-9_-]*$' THEN
    RAISE EXCEPTION 'entry_type is required' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(coalesce(p_content, '')), '') IS NULL THEN
    RAISE EXCEPTION 'content is required' USING ERRCODE = '22023';
  END IF;

  CASE p_subject_type
    WHEN 'twin' THEN
      IF NOT EXISTS (SELECT 1 FROM public.twin_entities t WHERE t.id = p_subject_id) THEN
        RAISE EXCEPTION 'Subject not found: twin %', p_subject_id USING ERRCODE = '22023';
      END IF;
      SELECT r.source_key::uuid INTO v_user
      FROM public.twin_external_refs r
      WHERE r.twin_id = p_subject_id AND r.ref_kind = 'account' AND r.state = 'confirmed' AND r.valid_to IS NULL
        AND r.source_key ~ '^[0-9a-fA-F-]{36}$'
      LIMIT 1;
    WHEN 'actor' THEN
      IF NOT EXISTS (SELECT 1 FROM aisha_auth.users u WHERE u.id = p_subject_id) THEN
        RAISE EXCEPTION 'Subject not found: actor %', p_subject_id USING ERRCODE = '22023';
      END IF;
      v_user := p_subject_id;
    WHEN 'story' THEN
      IF NOT EXISTS (SELECT 1 FROM public.partner_stories ps WHERE ps.id = p_subject_id) THEN
        RAISE EXCEPTION 'Subject not found: story %', p_subject_id USING ERRCODE = '22023';
      END IF;
      v_story := p_subject_id;
  END CASE;

  v_entry := public.append_subject_entry_service(
    p_subject_type := p_subject_type,
    p_subject_id   := p_subject_id,
    p_entry_type   := p_entry_type,
    p_content      := btrim(p_content),
    p_metadata     := jsonb_strip_nulls(jsonb_build_object(
                        'source', 'surface_action',
                        'follow_up_at', p_follow_up_at,
                        'logged_by', v_uid)),
    p_created_by   := v_uid,
    p_story_id     := v_story,
    p_is_internal  := false,
    p_occurred_at  := coalesce(p_occurred_at, now()));

  IF p_follow_up_at IS NOT NULL THEN
    IF v_user IS NOT NULL THEN
      v_beat := public.audience_admin_create_followup(v_user, p_follow_up_at, btrim(p_content), v_uid);
    ELSE
      v_beat := public.create_pulse_beat_audited(
        p_subject_type := p_subject_type, p_subject_id := p_subject_id,
        p_beat_type := 'follow_up', p_due_at := p_follow_up_at,
        p_assigned_to_user_id := v_uid, p_source_type := 'touch', p_source_id := v_entry,
        p_note := btrim(p_content));
    END IF;
  END IF;

  PERFORM public.audience_log_event(
    'log_touch', 'audience_admin_log_touch', p_subject_type, p_subject_id,
    format('Touch %s logged on %s', p_entry_type, p_subject_type),
    jsonb_build_object('entry_id', v_entry, 'entry_type', p_entry_type,
                       'follow_up_at', p_follow_up_at, 'beat_id', v_beat));
  RETURN v_entry;
END;
$$;

REVOKE ALL ON FUNCTION public.audience_admin_log_touch(text, uuid, text, text, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audience_admin_log_touch(text, uuid, text, text, timestamptz, timestamptz) TO authenticated, service_role;
