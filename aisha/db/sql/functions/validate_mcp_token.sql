-- Function: public.validate_mcp_token
-- Arguments: p_token_hash text, p_tool_name text DEFAULT NULL::text, p_project_id uuid DEFAULT NULL::uuid
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.validate_mcp_token(p_token_hash text, p_tool_name text DEFAULT NULL::text, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_token RECORD;
BEGIN
  SELECT * INTO v_token
  FROM mcp_auth_tokens
  WHERE token_hash = p_token_hash
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > now());

  IF v_token IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'token_not_found_or_expired');
  END IF;

  -- Check scope
  IF v_token.scope = 'project' AND v_token.project_id != p_project_id THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'project_scope_mismatch');
  END IF;

  -- Check tool permission
  IF p_tool_name IS NOT NULL THEN
    IF v_token.denied_tools @> ARRAY[p_tool_name] THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'tool_denied');
    END IF;
    IF array_length(v_token.allowed_tools, 1) > 0
       AND NOT (v_token.allowed_tools @> ARRAY[p_tool_name]) THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'tool_not_allowed');
    END IF;
  END IF;

  -- Update usage
  UPDATE mcp_auth_tokens
  SET last_used_at = now(), usage_count = usage_count + 1
  WHERE id = v_token.id;

  RETURN jsonb_build_object(
    'valid', true,
    'user_id', v_token.user_id,                 -- §8: chargeback/audit identity (req.user.sub)
    'story_id', v_token.scoped_to_story_id,      -- §8.5: derived story scope (NULL ⇒ caller fail-closes)
    'scoped_to_story_id', v_token.scoped_to_story_id,
    'scope', v_token.scope,
    'account_id', v_token.account_id,
    'project_id', v_token.project_id,
    'rate_limit_rpm', v_token.rate_limit_rpm,
    'rate_limit_daily', v_token.rate_limit_daily,
    -- Seznamy nástrojů pro autorizaci VOLAJÍCÍ služby (svc-mcp-knowledge filtruje
    -- tools/list a odmítá tools/call týmž predikátem). Bez nich by musela volat
    -- tuhle funkci pro každý nástroj zvlášť — a každé volání navyšuje usage_count.
    -- Sémantika shodná s kontrolou výše: prázdné allowed_tools = bez omezení.
    'allowed_tools', to_jsonb(COALESCE(v_token.allowed_tools, '{}'::text[])),
    'denied_tools', to_jsonb(COALESCE(v_token.denied_tools, '{}'::text[]))
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_mcp_token(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_mcp_token(text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_mcp_token(text, text, uuid) TO service_role;
