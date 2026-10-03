-- Function: audience_admin_export_audience

CREATE OR REPLACE FUNCTION public.audience_admin_export_audience(p_filter jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 10000)
 RETURNS TABLE(user_id uuid, display_name text, email text, member_tier text, audience_size integer, tags text[], last_active_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Log the export for audit/compliance
  PERFORM public.audience_log_event(
    'export',
    'audience_admin_export_audience',
    'export',
    NULL,
    'Exported audience data',
    jsonb_build_object('filter', p_filter, 'limit', p_limit)
  );

  RETURN QUERY
  SELECT
    cd.user_id,
    cd.display_name,
    cd.email,
    cd.member_tier,
    cd.audience_size,
    cd.tags,
    cd.last_active_at
  FROM public.audience_admin_contact_directory_v cd
  WHERE
    (NOT (p_filter ? 'tier') OR cd.member_tier = p_filter->>'tier')
    AND (NOT (p_filter ? 'tag') OR (p_filter->>'tag') = ANY(cd.tags))
  LIMIT p_limit;
END;
$function$

;

REVOKE ALL ON FUNCTION audience_admin_export_audience(jsonb,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_admin_export_audience(jsonb,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION audience_admin_export_audience(jsonb,integer) TO authenticator;
GRANT EXECUTE ON FUNCTION audience_admin_export_audience(jsonb,integer) TO service_role;
