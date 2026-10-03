-- Function: public.get_study_consultants_admin
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:34+01:00

CREATE OR REPLACE FUNCTION public.get_study_consultants_admin()
 RETURNS TABLE(id uuid, study_id uuid, partner_id uuid, status text, role text, max_participants integer, created_at timestamptz, approved_at timestamptz, study jsonb, partner jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;


  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'read'::public.journal_action_type,
      p_area := 'research'::public.journal_area,
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'study_consultant',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read study consultant',
      p_tags := ARRAY['admin', 'study_consultant'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT 
    sc.id,
    sc.study_id,
    sc.partner_id,
    sc.status::text,
    COALESCE(sc.role::text, 'consultant') AS role,
    sc.max_participants,
    sc.created_at,
    sc.approved_at,
    jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'code', s.code
    ) AS study,
    jsonb_build_object(
      'id', pp.id,
      'display_name', COALESCE(pp.display_name, 'Unknown'),
      'business_name', pp.business_name,
      'city', COALESCE(pp.city, ''),
      'is_production_provider', COALESCE(pp.is_production_provider, false),
      'email', pp.email
    ) AS partner
  FROM public.study_consultants sc
  LEFT JOIN public.partner_profiles pp ON sc.partner_id = pp.id
  LEFT JOIN public.studies s ON sc.study_id = s.id
  ORDER BY sc.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_study_consultants_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_study_consultants_admin() TO authenticated;
