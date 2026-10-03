-- Function: public.get_my_partner_certifications
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:00+01:00

CREATE OR REPLACE FUNCTION public.get_my_partner_certifications()
 RETURNS TABLE(id uuid, user_id uuid, score integer, passed boolean, answers jsonb, completed_at timestamptz, created_at timestamptz)
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
    pc.id,
    pc.user_id,
    pc.score,
    pc.passed,
    pc.answers,
    pc.completed_at,
    pc.created_at
  FROM partner_certifications pc
  WHERE pc.user_id = v_user_id
  ORDER BY pc.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_partner_certifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_partner_certifications() TO authenticated;
