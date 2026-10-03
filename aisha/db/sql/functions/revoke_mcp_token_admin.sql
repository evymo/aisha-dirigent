-- Function: public.revoke_mcp_token_admin
-- Arguments: p_id uuid
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.revoke_mcp_token_admin(p_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = 'P0003';
  END IF;

  UPDATE mcp_auth_tokens
  SET
    is_active = false,
    expires_at = now(),
    allowed_tools = '{}'::text[],
    denied_tools = '{}'::text[]
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MCP token not found: %', p_id USING ERRCODE = 'P0002';
  END IF;

  RETURN p_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.revoke_mcp_token_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_mcp_token_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_mcp_token_admin(uuid) TO service_role;
