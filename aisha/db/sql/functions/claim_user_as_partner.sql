-- Function: public.claim_user_as_partner
-- Arguments: p_onboarding_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:59+01:00

CREATE OR REPLACE FUNCTION public.claim_user_as_partner(p_onboarding_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_partner_id uuid;
  v_user_id uuid;
BEGIN
  -- Get partner_id
  SELECT pp.id INTO v_partner_id 
  FROM partner_profiles pp 
  WHERE pp.user_id = v_caller_id
  AND pp.certification_passed_at IS NOT NULL;

  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: must be certified partner';
  END IF;

  -- Get user_id from onboarding
  SELECT uo.user_id INTO v_user_id
  FROM onboarding_responses uo
  WHERE uo.id = p_onboarding_id
  AND uo.assigned_partner_id IS NULL;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Onboarding not found or already claimed';
  END IF;

  -- Assign partner
  UPDATE onboarding_responses uo SET
    assigned_partner_id = v_partner_id
  WHERE uo.id = p_onboarding_id;

  -- Audit log with correct enum values
  PERFORM public.write_audit_journal(
      p_action_type := 'create',
      p_area := 'partner_matching',
      p_details := jsonb_build_object(
      'partner_id', v_partner_id,
      'user_id', v_user_id,
      'onboarding_id', p_onboarding_id,
      'action_detail', 'partner_assignment'
    ),
      p_entity_id := p_onboarding_id::text,
      p_entity_type := -- Changed from 'assign' to 'create' 
    'onboarding_responses',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Partner claimed user from onboarding pool',
      p_tags := ARRAY['partner', 'matching', 'assignment'],
      p_user_id := v_caller_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'partner_id', v_partner_id
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.claim_user_as_partner(p_onboarding_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_user_as_partner(p_onboarding_id uuid) TO authenticated;
