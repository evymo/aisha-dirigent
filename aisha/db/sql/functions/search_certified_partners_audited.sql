-- Function: public.search_certified_partners_audited
-- Arguments: p_search text, p_limit integer DEFAULT 20
-- Description: Search certified partners for story invitation.
-- Security: SECURITY DEFINER, authenticated only
-- Source: Migration 20260329230000_story_participants_foundation.sql

CREATE OR REPLACE FUNCTION public.search_certified_partners_audited(
  p_search text,
  p_limit integer DEFAULT 20
)
 RETURNS TABLE(
   user_id uuid,
   display_name text,
   business_name text,
   certification_level text,
   avatar_url text
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Audit
  PERFORM public.write_audit_journal(
    p_action_type := 'access'::public.journal_action_type,
    p_area := 'partner'::public.journal_area,
    p_details := jsonb_build_object('search_query_length', length(p_search)),
    p_entity_id := NULL,
    p_entity_type := 'partner_profiles',
    p_severity := 'info'::public.journal_severity,
    p_summary := 'Searched certified partners for story invitation',
    p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT
    pp.user_id,
    COALESCE(p.first_name || ' ' || LEFT(p.last_name, 1) || '.', 'Unknown') AS display_name,
    pp.business_name,
    pp.certification_level::text,
    p.avatar_url
  FROM public.partner_profiles pp
  JOIN public.profiles p ON p.id = pp.user_id
  WHERE pp.certification_passed_at IS NOT NULL
    AND pp.user_id != v_user_id
    AND (
      p.first_name ILIKE '%' || p_search || '%'
      OR p.last_name ILIKE '%' || p_search || '%'
      OR pp.business_name ILIKE '%' || p_search || '%'
    )
  ORDER BY pp.business_name ASC
  LIMIT p_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.search_certified_partners_audited(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_certified_partners_audited(text, integer) TO authenticated;
