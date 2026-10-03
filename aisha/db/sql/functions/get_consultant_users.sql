-- Function: public.get_consultant_users
-- Arguments: none
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_consultant_users()
 RETURNS TABLE(registration_id uuid, user_id uuid, study_id uuid, study_name text, study_code text, status text, enrolled_at timestamptz, display_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_partner_id uuid;
BEGIN
  -- Get partner ID for current user
  SELECT id INTO v_partner_id
  FROM public.partner_profiles
  WHERE partner_profiles.user_id = auth.uid()
  LIMIT 1;

  IF v_partner_id IS NULL THEN
    RETURN; -- Return empty if not a partner
  END IF;

  INSERT INTO audit_journal (
    user_id, action_type, entity_type, area, severity, summary
  ) VALUES (
    auth.uid(), 'read'::journal_action_type, 'study_registrations',
    'research'::journal_area, 'info'::journal_severity,
    'Partner viewed their users list'
  );

  -- Return users assigned to this partner via study_consultants
  -- Only return users who have granted data_sharing_consent
  RETURN QUERY
  SELECT 
    se.id AS registration_id,
    se.user_id,
    se.study_id,
    COALESCE(st.name, '') AS study_name,
    COALESCE(st.code, '') AS study_code,
    se.status,
    se.enrolled_at,
    COALESCE(pr.display_name, '') AS display_name
  FROM public.study_registrations se
  JOIN public.study_consultants sc ON sc.study_id = se.study_id AND sc.partner_id = v_partner_id
  JOIN public.studies st ON st.id = se.study_id
  LEFT JOIN public.profiles pr ON pr.user_id = se.user_id
  WHERE sc.status = 'approved'
    AND se.status IN ('active', 'completed', 'pending')
    AND public.has_data_sharing_consent(se.user_id, auth.uid())
  ORDER BY se.enrolled_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_consultant_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_consultant_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_consultant_users() TO service_role;
