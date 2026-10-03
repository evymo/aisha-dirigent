-- Function: public.get_chat_access_level
-- Arguments: p_user_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:41+01:00

CREATE OR REPLACE FUNCTION public.get_chat_access_level(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_access_level TEXT := 'none';
  v_can_chat BOOLEAN := false;
  v_block_reason TEXT := NULL;
  v_has_terms_consent BOOLEAN := false;
  v_has_registration BOOLEAN := false;
  v_has_pending_registration BOOLEAN := false;
  v_has_active_membership BOOLEAN := false;
  v_membership_tier TEXT := NULL;
  v_registration_status TEXT := NULL;
  v_has_completed_questionnaire BOOLEAN := false;
  v_study_name TEXT := NULL;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'access_level', 'none',
      'can_chat', false,
      'block_reason', 'not_authenticated',
      'has_terms_consent', false
    );
  END IF;

  -- IDOR guard: the subject is always the caller. A cross-user lookup
  -- (p_user_id for a different user) is only honored for service role or admin/staff.
  IF p_user_id IS NOT NULL AND p_user_id <> v_user_id THEN
    IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
      RAISE EXCEPTION 'Not authorized to read chat access for another user'
        USING ERRCODE = '42501';
    END IF;
    v_user_id := p_user_id;
  END IF;

  -- Legal gate: user must have active data processing consent (acts as terms acceptance).
  SELECT EXISTS (
    SELECT 1
    FROM public.consents c
    WHERE c.user_id = v_user_id
      AND c.consent_type = 'data_processing'::public.consent_type
      AND c.granted = true
      AND c.revoked_at IS NULL
  ) INTO v_has_terms_consent;
  
  -- Check for active study registration
  SELECT 
    se.status,
    s.name
  INTO v_registration_status, v_study_name
  FROM public.study_registrations se
  JOIN public.studies s ON s.id = se.study_id
  WHERE se.user_id = v_user_id
  AND se.status IN ('active', 'enrolled', 'completed', 'screening', 'pending')
  ORDER BY 
    CASE se.status 
      WHEN 'active' THEN 1 
      WHEN 'enrolled' THEN 2 
      WHEN 'completed' THEN 3
      WHEN 'screening' THEN 4
      WHEN 'pending' THEN 5
    END
  LIMIT 1;
  
  -- Determine registration state
  v_has_registration := v_registration_status IN ('active', 'enrolled', 'completed');
  v_has_pending_registration := v_registration_status IN ('screening', 'pending');
  
  -- Check if user has completed onboarding questionnaire
  SELECT EXISTS (
    SELECT 1 FROM public.operational_assessments ca
    WHERE ca.user_id = v_user_id
    AND ca.assessment_type = 'onboarding'
    AND ca.status = 'completed'
  ) INTO v_has_completed_questionnaire;
  
  -- Check membership
  SELECT m.tier, m.status = 'active'
  INTO v_membership_tier, v_has_active_membership
  FROM public.memberships m
  WHERE m.user_id = v_user_id
  ORDER BY m.created_at DESC
  LIMIT 1;
  
  -- Determine access level with legal gate first.
  IF NOT v_has_terms_consent THEN
    v_access_level := 'basic';
    v_can_chat := false;
    v_block_reason := 'terms_not_accepted';
  ELSIF v_has_active_membership AND v_membership_tier = 'upgraded' THEN
    -- 'upgraded' is the paid tier (membership_tier: basic|upgraded|trial). The prior
    -- 'premium' literal was outside the enum, so this branch was dead.
    v_access_level := 'premium';
    v_can_chat := true;
  ELSIF v_has_active_membership THEN
    v_access_level := 'active';
    v_can_chat := true;
  ELSIF v_has_registration THEN
    v_access_level := 'enrolled';
    v_can_chat := true;
  ELSIF v_has_pending_registration THEN
    -- Registered user can still use chat after accepting terms.
    v_access_level := 'pending_approval';
    v_can_chat := true;
    v_block_reason := NULL;
  ELSIF NOT v_has_completed_questionnaire THEN
    -- Registered user can still use basic chat after accepting terms.
    v_access_level := 'needs_questionnaire';
    v_can_chat := true;
    v_block_reason := NULL;
  ELSE
    -- Registered user with terms accepted.
    v_access_level := 'basic';
    v_can_chat := true;
    v_block_reason := NULL;
  END IF;
  
  RETURN jsonb_build_object(
    'access_level', v_access_level,
    'can_chat', v_can_chat,
    'block_reason', v_block_reason,
    'has_terms_consent', v_has_terms_consent,
    'has_registration', v_has_registration,
    'has_pending_registration', v_has_pending_registration,
    'has_membership', v_has_active_membership,
    'membership_tier', v_membership_tier,
    'registration_status', v_registration_status,
    'study_name', v_study_name,
    'has_completed_questionnaire', v_has_completed_questionnaire
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_chat_access_level(p_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_chat_access_level(p_user_id uuid) TO authenticated;
