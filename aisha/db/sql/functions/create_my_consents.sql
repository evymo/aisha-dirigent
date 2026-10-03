-- Function: public.create_my_consents
-- Arguments: p_consent_types text[], p_study_id uuid, p_version text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:06+01:00

CREATE OR REPLACE FUNCTION public.create_my_consents(p_consent_types text[], p_study_id uuid DEFAULT NULL::uuid, p_version text DEFAULT '1.0'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_consent_type text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Audit log for consent creation
  PERFORM public.write_audit_journal(
      p_action_type := 'create',
      p_area := 'consent',
      p_details := jsonb_build_object('consent_types', p_consent_types, 'study_id', p_study_id),
      p_entity_id := NULL,
      p_entity_type := 'consents',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'User creating consent records',
      p_tags := ARRAY['phi','member','consent'],
      p_user_id := v_user_id
  );

  FOREACH v_consent_type IN ARRAY p_consent_types LOOP
    INSERT INTO consents (user_id, consent_type, granted, granted_at, version, study_id)
    VALUES (v_user_id, v_consent_type::consent_type, true, now(), p_version, p_study_id)
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_my_consents(p_consent_types text[], p_study_id uuid, p_version text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_my_consents(p_consent_types text[], p_study_id uuid, p_version text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_my_consents(p_consent_types text[], p_study_id uuid, p_version text) TO authenticated;
