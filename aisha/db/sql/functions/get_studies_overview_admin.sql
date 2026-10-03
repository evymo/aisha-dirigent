-- Function: public.get_studies_overview_admin
-- Arguments: (none)
-- Description: Returns studies overview with registration, contribution and consultant counts for admin panel.
-- Security: SECURITY DEFINER - requires manage_studies permission
-- Extracted: 2026-01-08T18:27:30+01:00

CREATE OR REPLACE FUNCTION public.get_studies_overview_admin()
 RETURNS TABLE(
   id uuid,
   code text,
   name text,
   name_key text,
   description text,
   description_key text,
   study_type text,
   target_condition text,
   products text[],
   duration_weeks integer,
   target_registration integer,
   min_participants integer,
   max_participants integer,
   funding_goal numeric,
   funding_deadline timestamptz,
   funding_status text,
   is_blinded boolean,
   is_active boolean,
   is_umbrella boolean,
   starts_at timestamptz,
   ends_at timestamptz,
   protocol_url text,
   current_registration integer,
   current_funding numeric,
   informed_consent_version text,
   informed_consent_special_provisions text,
   created_at timestamptz,
   updated_at timestamptz,
   registrations_count bigint,
   contributions_count bigint,
   consultants_count bigint,
   dynamic_funding numeric
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(auth.uid(), 'manage_studies') THEN
    RAISE EXCEPTION 'Access denied: manage_studies permission required';
  END IF;


  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'read'::public.journal_action_type,
      p_area := 'research'::public.journal_area,
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'studies_overview',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read studies overview',
      p_tags := ARRAY['admin', 'studies_overview'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    s.id,
    s.code,
    s.name,
    s.name_key,
    s.description,
    s.description_key,
    s.study_type::text,
    s.target_condition,
    s.products,
    s.duration_weeks,
    s.target_registration,
    s.min_participants,
    s.max_participants,
    s.funding_goal,
    s.funding_deadline,
    s.funding_status::text,
    s.is_blinded,
    s.is_active,
    s.is_umbrella,
    s.starts_at,
    s.ends_at,
    s.protocol_url,
    s.current_registration,
    s.current_funding,
    s.informed_consent_version,
    s.informed_consent_special_provisions,
    s.created_at,
    s.updated_at,
    COUNT(DISTINCT se.id)::bigint AS registrations_count,
    COUNT(DISTINCT sc_contrib.id)::bigint AS contributions_count,
    COUNT(DISTINCT sc_consult.id)::bigint AS consultants_count,
    COALESCE(SUM(sc_contrib.amount) FILTER (WHERE sc_contrib.status = 'completed'), 0)::numeric AS dynamic_funding
  FROM public.studies s
  LEFT JOIN public.study_registrations se ON se.study_id = s.id
  LEFT JOIN public.study_contributions sc_contrib ON sc_contrib.study_id = s.id
  LEFT JOIN public.study_consultants sc_consult ON sc_consult.study_id = s.id
  GROUP BY s.id
  ORDER BY s.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_studies_overview_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_studies_overview_admin() TO authenticated;
