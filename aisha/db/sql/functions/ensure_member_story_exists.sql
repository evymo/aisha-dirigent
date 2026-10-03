-- Function: public.ensure_member_story_exists
-- Arguments: (none)
-- Description: Idempotent — returns existing story ID for the authenticated member,
--              or auto-creates a story when an eligible active registration + consented
--              partner are found. Returns NULL when no eligible setup exists.
-- Security: SECURITY DEFINER; member-only (authenticated).

CREATE OR REPLACE FUNCTION public.ensure_member_story_exists()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id     uuid := auth.uid();
  v_story_id    uuid;
  v_partner_id  uuid;
  v_study_id    uuid;
  v_study_title text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Return existing story if any (most-recent first)
  SELECT ps.id INTO v_story_id
  FROM public.partner_stories ps
  WHERE ps.user_id = v_user_id
    AND ps.status NOT IN ('trash')
  ORDER BY ps.last_activity_at DESC
  LIMIT 1;

  IF v_story_id IS NOT NULL THEN
    RETURN v_story_id;
  END IF;

  -- 2. Find an eligible active registration with a consented partner
  SELECT
    se.study_id,
    sc.partner_id,
    s.name
  INTO
    v_study_id,
    v_partner_id,
    v_study_title
  FROM public.study_registrations se
  JOIN public.study_consultants sc
    ON sc.study_id = se.study_id
   AND sc.status = 'approved'
  JOIN public.data_sharing_consents dsc
    ON dsc.user_id        = v_user_id
   AND dsc.partner_id     = sc.partner_id
   AND dsc.revoked_at     IS NULL
   AND (dsc.expires_at IS NULL OR dsc.expires_at > now())
  JOIN public.studies s
    ON s.id = se.study_id
  WHERE se.user_id = v_user_id
    AND se.status  = 'active'
  ORDER BY se.enrolled_at DESC
  LIMIT 1;

  IF v_partner_id IS NULL THEN
    -- No eligible registration / consent — return null gracefully
    RETURN NULL;
  END IF;

  -- 3. Auto-create story (idempotent: double-checked above)
  INSERT INTO public.partner_stories (
    partner_id,
    user_id,
    study_id,
    title,
    status,
    priority
  )
  VALUES (
    v_partner_id,
    v_user_id,
    v_study_id,
    COALESCE(v_study_title, 'My Story'),
    'inbox',
    'normal'
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_story_id;

  -- If conflict prevented insert, fetch the existing row
  IF v_story_id IS NULL THEN
    SELECT ps.id INTO v_story_id
    FROM public.partner_stories ps
    WHERE ps.user_id = v_user_id
      AND ps.study_id   = v_study_id
    LIMIT 1;
  END IF;

  IF v_story_id IS NOT NULL THEN
    PERFORM public.write_audit_journal(
      p_action_type := 'create'::public.journal_action_type,
      p_area        := 'member'::public.journal_area,
      p_details     := jsonb_build_object(
        'auto_created', true,
        'study_id',     v_study_id,
        'partner_id',   v_partner_id
      ),
      p_entity_id   := v_story_id,
      p_entity_type := 'partner_stories',
      p_severity    := 'notice'::public.journal_severity,
      p_summary     := 'Auto-created story for member diary access',
    p_user_id := v_user_id
  );
  END IF;

  RETURN v_story_id;
END;
$$;

-- Permissions
REVOKE ALL     ON FUNCTION public.ensure_member_story_exists() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ensure_member_story_exists() FROM anon;
GRANT  EXECUTE ON FUNCTION public.ensure_member_story_exists() TO authenticated;
