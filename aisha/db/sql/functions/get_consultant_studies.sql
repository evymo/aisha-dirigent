-- Function: public.get_consultant_studies
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:44+01:00

CREATE OR REPLACE FUNCTION public.get_consultant_studies()
 RETURNS TABLE(id uuid, study_id uuid, partner_id uuid, status text, applied_at timestamptz, approved_at timestamptz, study_name text, study_code text, study_status text, registration_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_partner_id UUID;
BEGIN
  -- Get partner profile for current user
  SELECT pp.id INTO v_partner_id
  FROM partner_profiles pp
  WHERE pp.user_id = auth.uid();

  IF v_partner_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 
    sc.id,
    sc.study_id,
    sc.partner_id,
    sc.status::TEXT,
    sc.applied_at,
    sc.approved_at,
    s.name as study_name,
    s.code as study_code,
    s.status::TEXT as study_status,
    (SELECT COUNT(*) FROM study_registrations se WHERE se.study_id = sc.study_id AND se.consultant_id = sc.id) as registration_count
  FROM study_consultants sc
  JOIN studies s ON s.id = sc.study_id
  WHERE sc.partner_id = v_partner_id
  ORDER BY sc.applied_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_consultant_studies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_consultant_studies() TO authenticated;
