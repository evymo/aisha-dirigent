-- Function: public.get_my_study_consultant_application
-- Arguments: p_study_id uuid, p_partner_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:05+01:00

CREATE OR REPLACE FUNCTION public.get_my_study_consultant_application(p_study_id uuid, p_partner_id uuid)
 RETURNS TABLE(id uuid, study_id uuid, partner_id uuid, role text, status text, max_participants integer, notes text, approved_at timestamptz, created_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  SELECT 
    sc.id,
    sc.study_id,
    sc.partner_id,
    sc.role::text,
    sc.status::text,
    sc.max_participants,
    sc.notes,
    sc.approved_at,
    sc.created_at
  FROM study_consultants sc
  JOIN partner_profiles pp ON pp.id = sc.partner_id
  WHERE sc.study_id = p_study_id
    AND sc.partner_id = p_partner_id
    AND pp.user_id = v_user_id
  LIMIT 1;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_study_consultant_application(p_study_id uuid, p_partner_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_study_consultant_application(p_study_id uuid, p_partner_id uuid) TO authenticated;
