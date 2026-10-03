-- Function: public.get_my_consents
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:54+01:00

CREATE OR REPLACE FUNCTION public.get_my_consents()
 RETURNS TABLE(id uuid, user_id uuid, consent_type consent_type, study_id uuid, version text, granted boolean, granted_at timestamptz, revoked_at timestamptz, document_url text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO audit_journal (user_id, action, action_type, area, entity_type, summary, severity)
  VALUES (v_user_id, 'READ_CONSENTS', 'read', 'consents', 'consents', 'User read their consents', 'info');
  
  RETURN QUERY
  SELECT c.id, c.user_id, c.consent_type, c.study_id, c.version, c.granted, c.granted_at, c.revoked_at, c.document_url
  FROM consents c
  WHERE c.user_id = v_user_id
  ORDER BY c.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_consents() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_consents() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_consents() TO authenticated;
