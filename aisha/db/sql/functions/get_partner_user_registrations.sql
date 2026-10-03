-- Function: public.get_partner_user_registrations
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:11+01:00

CREATE OR REPLACE FUNCTION public.get_partner_user_registrations()
 RETURNS TABLE(registration_id uuid, user_id uuid, study_id uuid, study_name text, study_code text, registration_status text, consultant_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_partner_id UUID;
BEGIN
  -- Audit log for partner accessing user registrations (sensitive data)
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'get_partner_user_registrations',
    jsonb_build_object(
      'area', 'phi',
      'severity', 'info',
      'entity_type', 'study_registrations'
    )
  );

  -- Get partner profile
  SELECT pp.id INTO v_partner_id
  FROM partner_profiles pp
  WHERE pp.user_id = auth.uid();

  IF v_partner_id IS NULL THEN
    RETURN;
  END IF;

  -- Return registrations where this partner is the consultant
  -- Only return users who have granted data_sharing_consent
  RETURN QUERY
  SELECT 
    se.id as registration_id,
    se.user_id,
    se.study_id,
    s.name as study_name,
    s.code as study_code,
    se.status::TEXT as registration_status,
    se.consultant_id
  FROM study_registrations se
  JOIN studies s ON s.id = se.study_id
  JOIN study_consultants sc ON sc.id = se.consultant_id
  WHERE sc.partner_id = v_partner_id
    AND sc.status = 'approved'
    AND public.has_data_sharing_consent(se.user_id, auth.uid())
  ORDER BY se.enrolled_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_partner_user_registrations() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_partner_user_registrations() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_partner_user_registrations() TO authenticated;
