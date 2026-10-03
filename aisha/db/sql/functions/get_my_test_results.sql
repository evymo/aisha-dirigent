-- Function: public.get_my_test_results
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:06+01:00

CREATE OR REPLACE FUNCTION public.get_my_test_results()
 RETURNS TABLE(id uuid, test_type text, score integer, passed boolean, completed_at timestamptz, answers jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT 
    pc.id,
    'partner_certification'::TEXT as test_type,
    pc.score,
    pc.passed,
    pc.completed_at,
    pc.answers
  FROM partner_certifications pc
  WHERE pc.user_id = auth.uid()
  ORDER BY pc.completed_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_test_results() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_test_results() TO authenticated;
