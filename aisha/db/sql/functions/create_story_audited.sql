-- Function: public.create_story_audited
-- Arguments: p_user_id uuid, p_study_id uuid, p_title text
-- Description: Partner creates a story for user OR member creates self story in enrolled study.
-- Security: SECURITY DEFINER - enforces role, ownership, registration and consent checks.
-- @audit: required
-- @phi: true

CREATE OR REPLACE FUNCTION public.create_story_audited(p_user_id uuid, p_study_id uuid DEFAULT NULL::uuid, p_title text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_partner_id UUID;
  v_story_partner_id UUID;
  v_owner_mode TEXT;
  v_story_id UUID;
  v_story_study_id UUID;
  v_title TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_partner_id := public.get_current_partner_id();

  IF v_partner_id IS NOT NULL THEN
    v_owner_mode := 'partner';
    v_story_partner_id := v_partner_id;
    v_story_study_id := p_study_id;

    -- Partner mode: consent is required for member data access.
    IF NOT public.has_data_sharing_consent(p_user_id, v_user_id) THEN
      RAISE EXCEPTION 'Unauthorized: No data sharing consent from user';
    END IF;
  ELSE
    v_owner_mode := 'member';

    -- Member mode: only members can create their own story.
    IF NOT public.has_role(v_user_id, 'member') THEN
      RAISE EXCEPTION 'Unauthorized: Member role required';
    END IF;

    IF p_user_id IS DISTINCT FROM v_user_id THEN
      RAISE EXCEPTION 'Unauthorized: Members can create stories only for themselves';
    END IF;

    IF p_study_id IS NULL THEN
      RAISE EXCEPTION 'Study is required for member story creation';
    END IF;

    -- Resolve partner from active/enrolled study assignment.
    -- Prefer explicit consultant assignment; fallback to any approved consultant
    -- in the study only if member has active consent for that consultant.
    SELECT sc.partner_id
      INTO v_story_partner_id
    FROM public.study_registrations se
    JOIN public.study_consultants sc
      ON sc.study_id = se.study_id
     AND sc.status = 'approved'
    JOIN public.data_sharing_consents dsc
      ON dsc.user_id = v_user_id
     AND dsc.partner_id = sc.partner_id
     AND dsc.revoked_at IS NULL
     AND (dsc.expires_at IS NULL OR dsc.expires_at > now())
    WHERE se.user_id = v_user_id
      AND se.study_id = p_study_id
      AND se.status::text IN ('enrolled', 'active')
      AND (
        (se.consultant_id IS NOT NULL AND sc.id = se.consultant_id)
        OR se.consultant_id IS NULL
      )
    ORDER BY
      CASE WHEN se.consultant_id IS NOT NULL AND sc.id = se.consultant_id THEN 0 ELSE 1 END,
      sc.approved_at DESC NULLS LAST,
      sc.created_at DESC
    LIMIT 1;

    IF v_story_partner_id IS NULL THEN
      RAISE EXCEPTION 'Unauthorized: No eligible consultant assignment or consent for selected study';
    END IF;

    v_story_study_id := p_study_id;
  END IF;

  -- Generate title if not provided
  v_title := COALESCE(NULLIF(TRIM(p_title), ''), 'Případ ' || to_char(now(), 'YYYY-MM-DD'));

  INSERT INTO public.partner_stories (
    partner_id, user_id, study_id, title
  ) VALUES (
    v_story_partner_id, p_user_id, v_story_study_id, v_title
  )
  RETURNING id INTO v_story_id;

  -- Audit (no sensitive data - just IDs)
  PERFORM public.write_audit_journal(
      p_action_type := 'create',
      p_area := CASE WHEN v_owner_mode = 'partner' THEN 'partner' ELSE 'member' END::public.journal_area,
      p_details := jsonb_build_object(
        'owner_mode', v_owner_mode,
        'story_id', v_story_id,
        'user_id', p_user_id,
        'study_id', v_story_study_id
      ),
      p_entity_id := NULL,
      p_entity_type := 'partner_stories',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := CASE
        WHEN v_owner_mode = 'partner' THEN 'Partner created new story'
        ELSE 'Member created new story'
      END,
      p_tags := ARRAY['phi', 'story', 'create'],
      p_user_id := v_user_id
  );

  RETURN v_story_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_story_audited(p_user_id uuid, p_study_id uuid, p_title text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_story_audited(p_user_id uuid, p_study_id uuid, p_title text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_story_audited(p_user_id uuid, p_study_id uuid, p_title text) TO authenticated;
