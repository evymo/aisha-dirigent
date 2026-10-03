-- Function: public.get_my_contributions
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:54+01:00

CREATE OR REPLACE FUNCTION public.get_my_contributions()
 RETURNS TABLE(id uuid, study_id uuid, user_id uuid, contribution_type text, amount numeric, currency text, token_type text, message text, is_anonymous boolean, status text, created_at timestamptz)
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
    sc.user_id,
    sc.contribution_type::text,
    sc.amount,
    sc.currency,
    sc.token_type,
    sc.message,
    sc.is_anonymous,
    sc.status::text,
    sc.created_at
  FROM study_contributions sc
  WHERE sc.user_id = v_user_id
  ORDER BY sc.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_contributions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_contributions() TO authenticated;
