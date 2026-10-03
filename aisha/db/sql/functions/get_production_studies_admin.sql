-- Function: public.get_production_studies_admin
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:22+01:00

CREATE OR REPLACE FUNCTION public.get_production_studies_admin()
 RETURNS TABLE(id uuid, code text, name text, description text, study_type text, is_active boolean, is_umbrella boolean, created_at timestamptz, updated_at timestamptz)
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
    auth.uid(), 'read'::journal_action_type, 'studies', 
    'research'::journal_area, 'info'::journal_severity,
    'Admin viewed production studies'
  );
  
  RETURN QUERY 
  SELECT s.id, s.code, s.name, s.description,
         s.study_type::text, COALESCE(s.is_active, true),
         COALESCE(s.is_umbrella, false), s.created_at, s.updated_at
  FROM public.studies s
  ORDER BY s.name;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_production_studies_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_studies_admin() TO authenticated;
