-- Function: public.update_my_profile_contact_audited
-- Arguments: p_display_name text, p_phone text, p_preferred_language text, p_preferred_currency text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:20+01:00

CREATE OR REPLACE FUNCTION public.update_my_profile_contact_audited(
  p_display_name text DEFAULT NULL::text,
  p_phone text DEFAULT NULL::text,
  p_preferred_language text DEFAULT NULL::text,
  p_preferred_currency text DEFAULT NULL::text
)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_updated_fields TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Authorization check
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Build list of updated fields for audit (without values - sensitive data protection)
  IF p_display_name IS NOT NULL THEN
    v_updated_fields := array_append(v_updated_fields, 'display_name');
  END IF;
  IF p_phone IS NOT NULL THEN
    v_updated_fields := array_append(v_updated_fields, 'phone');
  END IF;
  IF p_preferred_language IS NOT NULL THEN
    v_updated_fields := array_append(v_updated_fields, 'preferred_language');
  END IF;
  IF p_preferred_currency IS NOT NULL THEN
    v_updated_fields := array_append(v_updated_fields, 'preferred_currency');
  END IF;

  -- Update profile with only non-null fields
  UPDATE profiles
  SET
    display_name = COALESCE(p_display_name, display_name),
    phone = COALESCE(p_phone, phone),
    preferred_language = COALESCE(p_preferred_language, preferred_language),
    preferred_currency = COALESCE(p_preferred_currency, preferred_currency),
    updated_at = NOW()
  WHERE user_id = v_user_id;

  -- Write audit log (no sensitive data values stored)
  PERFORM public.write_audit_journal(
      p_action_type := 'update'::journal_action_type,
      p_area := 'profile'::journal_area,
      p_details := jsonb_build_object('updated_fields', v_updated_fields),
      p_entity_id := v_user_id::TEXT,
      p_entity_type := 'profile_contact',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info'::journal_severity,
      p_summary := 'User updated contact profile',
      p_tags := ARRAY['profile', 'contact', 'self-service'],
      p_user_id := v_user_id
  );

  RETURN TRUE;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_my_profile_contact_audited(p_display_name text, p_phone text, p_preferred_language text, p_preferred_currency text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_my_profile_contact_audited(p_display_name text, p_phone text, p_preferred_language text, p_preferred_currency text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_my_profile_contact_audited(p_display_name text, p_phone text, p_preferred_language text, p_preferred_currency text) TO authenticated;
