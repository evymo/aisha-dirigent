-- Function: trigger_auto_create_story_on_registration
-- Purpose: Auto-create a partner_stories row when member registration becomes active.
--          This ensures add_system_timeline_entry() has a target story and does not
--          silently skip entries with { success: false, reason: 'no_story' }.
-- Tables: study_registrations -> partner_stories
-- Security: SECURITY DEFINER (trigger context, no auth.uid())

CREATE OR REPLACE FUNCTION public.trigger_auto_create_story_on_registration()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_story_exists BOOLEAN;
  v_partner_id UUID;
  v_study_title TEXT;
  v_story_id UUID;
BEGIN
  -- Only fire when status changes to 'active'
  IF NOT (
    (TG_OP = 'INSERT' AND NEW.status = 'active')
    OR (TG_OP = 'UPDATE' AND NEW.status = 'active' AND OLD.status IS DISTINCT FROM NEW.status)
  ) THEN
    RETURN NEW;
  END IF;

  -- Check if story already exists for this user + study
  SELECT EXISTS (
    SELECT 1 FROM partner_stories
    WHERE user_id = NEW.user_id
      AND study_id = NEW.study_id
  ) INTO v_story_exists;

  IF v_story_exists THEN
    RETURN NEW;
  END IF;

  -- Get study title for the story name
  SELECT title INTO v_study_title
  FROM studies
  WHERE id = NEW.study_id;

  -- Resolve partner: prefer explicit consultant assignment, fallback to any approved
  -- consultant in the study with active consent from this member.
  -- (Mirrors create_story_audited partner resolution logic, lines 57-79)
  SELECT sc.partner_id
    INTO v_partner_id
  FROM study_consultants sc
  JOIN data_sharing_consents dsc
    ON dsc.user_id = NEW.user_id
   AND dsc.partner_id = sc.partner_id
   AND dsc.revoked_at IS NULL
   AND (dsc.expires_at IS NULL OR dsc.expires_at > now())
  WHERE sc.study_id = NEW.study_id
    AND sc.status = 'approved'
    AND (
      (NEW.consultant_id IS NOT NULL AND sc.id = NEW.consultant_id)
      OR NEW.consultant_id IS NULL
    )
  ORDER BY
    CASE WHEN NEW.consultant_id IS NOT NULL AND sc.id = NEW.consultant_id THEN 0 ELSE 1 END,
    sc.approved_at DESC NULLS LAST,
    sc.created_at DESC
  LIMIT 1;

  -- Skip story creation when no partner found (partner_id is NOT NULL in schema).
  -- The story will be created later when a partner is assigned or consent is granted.
  IF v_partner_id IS NULL THEN
    INSERT INTO audit_journal (user_id, action, metadata)
    VALUES (
      NEW.user_id,
      'STORY_AUTO_CREATE_SKIPPED',
      jsonb_build_object(
        'area', 'member_timeline',
        'severity', 'warning',
        'reason', 'no_partner_found',
        'study_id', NEW.study_id,
        'registration_id', NEW.id
      )
    );
    RETURN NEW;
  END IF;

  -- Create story with resolved partner
  INSERT INTO partner_stories (
    partner_id, user_id, study_id, title, status
  ) VALUES (
    v_partner_id,
    NEW.user_id,
    NEW.study_id,
    COALESCE(v_study_title, 'Timeline') || ' — ' || to_char(now(), 'YYYY-MM-DD'),
    'inbox'
  )
  RETURNING id INTO v_story_id;

  -- Audit log (no sensitive data - only IDs)
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    NEW.user_id,
    'STORY_AUTO_CREATED',
    jsonb_build_object(
      'area', 'member_timeline',
      'severity', 'info',
      'entity_type', 'partner_stories',
      'entity_id', v_story_id,
      'study_id', NEW.study_id,
      'partner_id', v_partner_id,
      'registration_id', NEW.id
    )
  );

  RETURN NEW;
END;
$$;

-- Permissions: Trigger function - prevent direct invocation
REVOKE ALL ON FUNCTION public.trigger_auto_create_story_on_registration() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trigger_auto_create_story_on_registration() FROM anon;
-- Note: Triggers run with table owner privileges, not caller privileges
