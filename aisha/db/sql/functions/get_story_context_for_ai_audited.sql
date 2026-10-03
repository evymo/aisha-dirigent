-- Function: public.get_story_context_for_ai_audited
-- Arguments: p_story_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:29+01:00

CREATE OR REPLACE FUNCTION public.get_story_context_for_ai_audited(p_story_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_partner_id UUID;
  v_story RECORD;
  v_owner_mode TEXT;
  v_audit_area public.journal_area;
  v_has_consent BOOLEAN;
  v_context JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_partner_id := public.get_current_partner_id();

  -- Load story and resolve access mode.
  SELECT ps.* INTO v_story
  FROM public.partner_stories ps
  WHERE ps.id = p_story_id;
  
  IF v_story.id IS NULL THEN
    RAISE EXCEPTION 'Story not found';
  END IF;

  IF v_partner_id IS NOT NULL AND v_story.partner_id = v_partner_id THEN
    v_owner_mode := 'partner';
  ELSIF v_story.user_id = v_user_id THEN
    v_owner_mode := 'member';
  ELSE
    RAISE EXCEPTION 'Unauthorized: Story access denied';
  END IF;

  IF v_owner_mode = 'partner' THEN
    -- Partner sees sensitive data context only with active consent.
    SELECT EXISTS (
      SELECT 1
      FROM public.data_sharing_consents dsc
      WHERE dsc.user_id = v_story.user_id
        AND dsc.partner_id = v_partner_id
        AND dsc.revoked_at IS NULL
        AND (dsc.expires_at IS NULL OR dsc.expires_at > now())
    ) INTO v_has_consent;
  ELSE
    -- Member always sees own health context.
    v_has_consent := true;
  END IF;

  -- Build context (sensitive data only if consent exists)
  v_context := jsonb_build_object(
    'story_id', v_story.id,
    'study_id', v_story.study_id,
    'has_consent', v_has_consent,
    'timeline_summary', CASE WHEN v_has_consent THEN (
      SELECT jsonb_agg(
        jsonb_build_object(
          'type', se.entry_type,
          'date', se.created_at,
          'preview', LEFT(se.content, 200)
        ) ORDER BY se.created_at DESC
      )
      FROM public.story_entries se
      WHERE se.story_id = p_story_id
        AND (v_owner_mode = 'partner' OR se.is_internal = false)
      LIMIT 20
    ) ELSE NULL END,
    'study_info', CASE WHEN v_story.study_id IS NOT NULL THEN (
      SELECT jsonb_build_object('name', s.name, 'status', s.status)
      FROM public.studies s WHERE s.id = v_story.study_id
    ) ELSE NULL END
  );

  -- Add health data only if consent
  IF v_has_consent THEN
    v_context := v_context || jsonb_build_object(
      'recent_checkins', (
        SELECT jsonb_agg(
          jsonb_build_object(
            'date', hci.check_in_date,
            'type', hci.check_in_type,
            'pain_level', hci.pain_level,
            'energy_level', hci.energy_level,
            'mood_level', hci.mood_level
          ) ORDER BY hci.check_in_date DESC
        )
        FROM public.health_check_ins hci
        WHERE hci.user_id = v_story.user_id
        LIMIT 10
      ),
      'shared_documents_count', (
        CASE
          WHEN v_owner_mode = 'partner' THEN (
            SELECT COUNT(*)
            FROM public.document_sharing_permissions dsp
            WHERE dsp.user_id = v_story.user_id
              AND dsp.shared_with_partner_id = v_partner_id
              AND dsp.revoked_at IS NULL
          )
          ELSE (
            SELECT COUNT(*)
            FROM public.member_health_documents mhd
            WHERE mhd.user_id = v_story.user_id
          )
        END
      )
    );
  END IF;

  v_audit_area := CASE
    WHEN v_owner_mode = 'partner' THEN 'partner'::public.journal_area
    ELSE 'member'::public.journal_area
  END;

  -- Audit AI context access
  PERFORM public.write_audit_journal(
      p_action_type := 'access'::public.journal_action_type,
      p_area := v_audit_area,
      p_details := jsonb_build_object(
        'owner_mode', v_owner_mode,
        'has_consent', v_has_consent
      ),
      p_entity_id := p_story_id::text,
      p_entity_type := 'partner_stories',
      p_severity := 'info'::public.journal_severity,
      p_summary := CASE
        WHEN v_owner_mode = 'partner' THEN 'Partner accessed story context for AI'
        ELSE 'Member accessed story context for AI'
      END,
    p_user_id := v_user_id
  );

  RETURN v_context;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_story_context_for_ai_audited(p_story_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_story_context_for_ai_audited(p_story_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_story_context_for_ai_audited(p_story_id uuid) TO authenticated;
