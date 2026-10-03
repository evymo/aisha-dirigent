-- Function: public.get_mcp_tokens_admin
-- Arguments: none
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_mcp_tokens_admin()
 RETURNS TABLE(id uuid, scope text, allowed_tools text[], denied_tools text[], rate_limit_rpm integer, rate_limit_daily integer, usage_count bigint, is_active boolean, project_id uuid, account_id uuid, created_by uuid, last_used_at timestamptz, expires_at timestamptz, created_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = 'P0003';
  END IF;

  RETURN QUERY
  SELECT
    mt.id, mt.scope::text,
    mt.allowed_tools, mt.denied_tools,
    mt.rate_limit_rpm, mt.rate_limit_daily,
    mt.usage_count, mt.is_active,
    mt.project_id, mt.account_id, mt.created_by,
    mt.last_used_at, mt.expires_at, mt.created_at
  FROM mcp_auth_tokens mt
  ORDER BY mt.created_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_mcp_tokens_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mcp_tokens_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_mcp_tokens_admin() TO service_role;
