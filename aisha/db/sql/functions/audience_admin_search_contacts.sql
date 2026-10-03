-- Function: audience_admin_search_contacts

CREATE OR REPLACE FUNCTION public.audience_admin_search_contacts(p_query text DEFAULT NULL::text, p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(user_id uuid, display_name text, email text, member_tier text, business_name text, audience_size integer, last_active_at timestamp with time zone, tags text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    cd.user_id,
    cd.display_name,
    cd.email,
    cd.member_tier,
    cd.business_name,
    cd.audience_size,
    cd.last_active_at,
    cd.tags
  FROM public.audience_admin_contact_directory_v cd
  WHERE
    (p_query IS NULL OR (
      cd.display_name ILIKE '%' || p_query || '%' OR
      cd.email ILIKE '%' || p_query || '%' OR
      cd.business_name ILIKE '%' || p_query || '%'
    ))
    AND (NOT (p_filters ? 'tier') OR cd.member_tier = p_filters->>'tier')
    AND (NOT (p_filters ? 'has_audience') OR cd.audience_size > 0)
    AND (NOT (p_filters ? 'tag') OR (p_filters->>'tag') = ANY(cd.tags))
  ORDER BY cd.last_active_at DESC NULLS LAST
  LIMIT p_limit OFFSET p_offset;
END;
$function$

;

REVOKE ALL ON FUNCTION audience_admin_search_contacts(text,jsonb,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_admin_search_contacts(text,jsonb,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION audience_admin_search_contacts(text,jsonb,integer,integer) TO authenticator;
GRANT EXECUTE ON FUNCTION audience_admin_search_contacts(text,jsonb,integer,integer) TO service_role;
