-- Function: public.request_data_sharing_consent
-- Arguments: p_user_id uuid, p_message text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:00+01:00

CREATE OR REPLACE FUNCTION public.request_data_sharing_consent(p_user_id uuid, p_message text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid;
  v_is_assigned_partner boolean;
  v_partner_profile_id uuid;
  v_result jsonb;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check if caller is assigned partner
  v_is_assigned_partner := EXISTS (
    SELECT 1 FROM onboarding_responses
    WHERE user_id = p_user_id AND assigned_partner_id = v_caller_id
  );

  IF NOT v_is_assigned_partner THEN
    RAISE EXCEPTION 'Access denied: You are not assigned to this user';
  END IF;

  -- Get partner_profile_id for the caller
  SELECT id INTO v_partner_profile_id
  FROM partner_profiles
  WHERE user_id = v_caller_id;

  IF v_partner_profile_id IS NULL THEN
    RAISE EXCEPTION 'Partner profile not found';
  END IF;

  -- Insert consent request (revoked_at NULL means pending/granted)
  INSERT INTO data_sharing_consents (user_id, partner_id)
  VALUES (p_user_id, v_partner_profile_id)
  ON CONFLICT (user_id, partner_id) DO NOTHING;

  -- Audit the request
  PERFORM public.write_audit_journal(
      p_action_type := 'create'::journal_action_type,
      p_area := 'partner_action'::journal_area,
      p_details := jsonb_build_object(
      'partner_id', v_caller_id,
      'user_id', p_user_id,
      -- Do NOT log free-text messages (may contain sensitive data/PII). Record only presence/size.
      'message_provided', (p_message IS NOT NULL AND length(btrim(p_message)) > 0),
      'message_length', length(coalesce(p_message, ''))
    ),
      p_entity_id := NULL,
      p_entity_type := 'data_sharing_consent',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Partner requested data sharing consent from user',
      p_tags := ARRAY['partner', 'consent', 'request'],
      p_user_id := v_caller_id
  );

  v_result := jsonb_build_object(
    'success', true,
    'message', 'Consent request sent to user'
  );

  RETURN v_result;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.request_data_sharing_consent(p_user_id uuid, p_message text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_data_sharing_consent(p_user_id uuid, p_message text) TO authenticated;
