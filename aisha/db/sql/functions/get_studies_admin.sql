-- Function: public.get_studies_admin
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:30+01:00

CREATE OR REPLACE FUNCTION public.get_studies_admin()
 RETURNS TABLE(id uuid, code text, name text, description text, study_type text, target_condition text, is_active boolean, is_umbrella boolean, is_blinded boolean, parent_study_id uuid, duration_weeks integer, target_registration integer, current_registration integer, min_participants integer, max_participants integer, funding_goal numeric, current_funding numeric, funding_status text, funding_deadline timestamptz, starts_at timestamptz, ends_at timestamptz, protocol_url text, informed_consent_version text, informed_consent_special_provisions text, products text[], created_at timestamptz, updated_at timestamptz)
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
      p_entity_type := 'study',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read study',
      p_tags := ARRAY['admin', 'study'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT 
    s.id,
    s.code,
    s.name,
    COALESCE(s.description, '') AS description,
    s.study_type::text AS study_type,
    s.target_condition,
    COALESCE(s.is_active, true) AS is_active,
    s.is_umbrella,
    COALESCE(s.is_blinded, false) AS is_blinded,
    s.parent_study_id,
    COALESCE(s.duration_weeks, 0) AS duration_weeks,
    COALESCE(s.target_registration, 0) AS target_registration,
    COALESCE(s.current_registration, 0) AS current_registration,
    COALESCE(s.min_participants, 0) AS min_participants,
    s.max_participants,
    COALESCE(s.funding_goal, 0) AS funding_goal,
    COALESCE(s.current_funding, 0) AS current_funding,
    COALESCE(s.funding_status, 'draft') AS funding_status,
    s.funding_deadline,
    s.starts_at,
    s.ends_at,
    s.protocol_url,
    COALESCE(s.informed_consent_version, '1.0') AS informed_consent_version,
    COALESCE(s.informed_consent_special_provisions, '') AS informed_consent_special_provisions,
    s.products,
    s.created_at,
    s.updated_at
  FROM public.studies s
  ORDER BY s.is_umbrella DESC, s.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_studies_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_studies_admin() TO authenticated;
