-- Function: public.get_certification_test_results_admin
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:41+01:00

CREATE OR REPLACE FUNCTION public.get_certification_test_results_admin()
 RETURNS TABLE(id uuid, user_id uuid, score integer, passed boolean, completed_at timestamptz, answers jsonb, created_at timestamptz, user_display_name text, user_email text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Admin or staff access required';
  END IF;
  
  INSERT INTO audit_journal (
    user_id, action_type, entity_type, area, severity, summary
  ) VALUES (
    auth.uid(), 'read'::journal_action_type, 'certification_test_results', 
    'research'::journal_area, 'info'::journal_severity,
    'Admin viewed certification test results'
  );
  
  RETURN QUERY 
  SELECT pc.id, pc.user_id, pc.score, pc.passed, pc.completed_at,
         pc.answers, pc.created_at,
         COALESCE(p.display_name, p.first_name || ' ' || p.last_name) as user_display_name,
         p.email as user_email
  FROM public.partner_certifications pc
  LEFT JOIN public.profiles p ON p.user_id = pc.user_id
  ORDER BY pc.completed_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_certification_test_results_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_certification_test_results_admin() TO authenticated;
