-- Function: public.get_studies_funding_goals_admin
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:30+01:00

CREATE OR REPLACE FUNCTION public.get_studies_funding_goals_admin()
 RETURNS TABLE(id uuid, name text, code text, funding_goal numeric, current_funding numeric, funding_deadline timestamptz, funding_status text, is_active boolean)
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
    auth.uid(), 'read'::journal_action_type, 'studies_funding', 
    'research'::journal_area, 'info'::journal_severity,
    'Admin viewed funding goals'
  );
  
  RETURN QUERY
  SELECT s.id, s.name, s.code,
         COALESCE(s.funding_goal, 0::numeric),
         COALESCE(s.current_funding, 0::numeric),
         s.funding_deadline,
         COALESCE(s.funding_status, 'draft'),
         COALESCE(s.is_active, true)
  FROM public.studies s
  WHERE s.funding_goal IS NOT NULL AND s.funding_goal > 0
  ORDER BY s.funding_deadline NULLS LAST;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_studies_funding_goals_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_studies_funding_goals_admin() TO authenticated;
