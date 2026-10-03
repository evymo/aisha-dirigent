-- Function: public.create_mcp_token
-- Arguments: p_scope text, p_account_id uuid DEFAULT NULL::uuid, p_project_id uuid DEFAULT NULL::uuid, p_allowed_tools text[] DEFAULT '{}'::text[], p_denied_tools text[] DEFAULT '{}'::text[], p_rate_limit_rpm integer DEFAULT 60, p_rate_limit_daily integer DEFAULT 1000, p_expires_in_days integer DEFAULT 90
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.create_mcp_token(p_scope text, p_account_id uuid DEFAULT NULL::uuid, p_project_id uuid DEFAULT NULL::uuid, p_allowed_tools text[] DEFAULT '{}'::text[], p_denied_tools text[] DEFAULT '{}'::text[], p_rate_limit_rpm integer DEFAULT 60, p_rate_limit_daily integer DEFAULT 1000, p_expires_in_days integer DEFAULT 90)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_raw_token text;
  v_token_hash text;
  v_token_id uuid;
BEGIN
  -- Only admin/staff can create tokens
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Insufficient permissions' USING ERRCODE = '42501';
  END IF;

  -- Generate raw token (this is the only time it's visible)
  v_raw_token := 'mcp_' || encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');

  INSERT INTO mcp_auth_tokens (
    token_hash, scope, account_id, project_id,
    allowed_tools, denied_tools, rate_limit_rpm, rate_limit_daily,
    expires_at, created_by, user_id
  )
  VALUES (
    v_token_hash, p_scope, p_account_id, p_project_id,
    p_allowed_tools, p_denied_tools, p_rate_limit_rpm, p_rate_limit_daily,
    CASE WHEN p_expires_in_days > 0 THEN now() + (p_expires_in_days || ' days')::interval ELSE NULL END,
    auth.uid(), auth.uid()
  )
  RETURNING id INTO v_token_id;

  -- Return raw token ONCE (never stored in plaintext)
  RETURN jsonb_build_object(
    'token_id', v_token_id,
    'raw_token', v_raw_token,
    'scope', p_scope,
    'expires_at', CASE WHEN p_expires_in_days > 0 THEN now() + (p_expires_in_days || ' days')::interval ELSE NULL END,
    'warning', 'Store this token securely. It cannot be retrieved again.'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_mcp_token(text, uuid, uuid, text[][], text[][], integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_mcp_token(text, uuid, uuid, text[][], text[][], integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_mcp_token(text, uuid, uuid, text[][], text[][], integer, integer, integer) TO service_role;

-- §8.5 bind-at-issuance — scoped PAT minting (9-arg overload, distinct arity).
-- Mints a token bound to a story (scoped_to_story_id NOT NULL). This is the path
-- Omni provisioning + e2e fixtures use; the 8-arg form above mints unscoped tokens
-- that fail-closed at /v1 until re-issued via this function.
CREATE OR REPLACE FUNCTION public.create_mcp_token(p_scope text, p_scoped_to_story_id uuid, p_account_id uuid DEFAULT NULL::uuid, p_project_id uuid DEFAULT NULL::uuid, p_allowed_tools text[] DEFAULT '{}'::text[], p_denied_tools text[] DEFAULT '{}'::text[], p_rate_limit_rpm integer DEFAULT 60, p_rate_limit_daily integer DEFAULT 1000, p_expires_in_days integer DEFAULT 90)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_raw_token text;
  v_token_hash text;
  v_token_id uuid;
BEGIN
  -- §8.5 bind-at-issuance: a scoped token MUST name its story (both admin and self-service).
  IF p_scoped_to_story_id IS NULL THEN
    RAISE EXCEPTION 'scoped_to_story_id is required for bind-at-issuance (§8.5)' USING ERRCODE = '22004';
  END IF;

  -- Self-service minting (2026-07-07, IDE-axis napoj): a KC-authenticated user may mint a token
  -- bound to THEIR OWN identity (user_id = auth.uid(), hardcoded below — no identity escalation),
  -- scoped to a story they can access, with capped limits. Admin/staff retain unrestricted minting.
  -- Least-privilege: no scope escalation (mint-time story check mirrors fn_user_can_read_run's story
  -- authority; use-time /v1 story-binding via fn_user_can_read_run remains the backstop).
  IF NOT is_admin_or_staff() THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Authentication required to mint a token' USING ERRCODE = '42501';
    END IF;
    IF NOT (
      public.is_story_participant(auth.uid(), p_scoped_to_story_id)
      OR EXISTS (
        SELECT 1 FROM public.partner_stories ps
        WHERE ps.id = p_scoped_to_story_id
          AND (ps.user_id = auth.uid() OR ps.is_stack_default = true)
      )
    ) THEN
      RAISE EXCEPTION 'Cannot mint a token scoped to a story you cannot access' USING ERRCODE = '42501';
    END IF;
    -- Cap self-service caps + expiry (a self-minted token cannot request absurd limits).
    p_rate_limit_rpm   := LEAST(GREATEST(COALESCE(p_rate_limit_rpm, 60), 1), 120);
    p_rate_limit_daily := LEAST(GREATEST(COALESCE(p_rate_limit_daily, 1000), 1), 5000);
    p_expires_in_days  := LEAST(GREATEST(COALESCE(p_expires_in_days, 90), 1), 90);
    -- Self-service tokens carry a non-privileged scope only.
    IF p_scope IS NULL OR p_scope NOT IN ('story', 'chat') THEN
      p_scope := 'story';
    END IF;
  END IF;

  v_raw_token := 'mcp_' || encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');

  INSERT INTO mcp_auth_tokens (
    token_hash, scope, account_id, project_id,
    allowed_tools, denied_tools, rate_limit_rpm, rate_limit_daily,
    expires_at, created_by, user_id, scoped_to_story_id
  )
  VALUES (
    v_token_hash, p_scope, p_account_id, p_project_id,
    p_allowed_tools, p_denied_tools, p_rate_limit_rpm, p_rate_limit_daily,
    CASE WHEN p_expires_in_days > 0 THEN now() + (p_expires_in_days || ' days')::interval ELSE NULL END,
    auth.uid(), auth.uid(), p_scoped_to_story_id
  )
  RETURNING id INTO v_token_id;

  RETURN jsonb_build_object(
    'token_id', v_token_id,
    'raw_token', v_raw_token,
    'scope', p_scope,
    'scoped_to_story_id', p_scoped_to_story_id,
    'expires_at', CASE WHEN p_expires_in_days > 0 THEN now() + (p_expires_in_days || ' days')::interval ELSE NULL END,
    'warning', 'Store this token securely. It cannot be retrieved again.'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_mcp_token(text, uuid, uuid, uuid, text[][], text[][], integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_mcp_token(text, uuid, uuid, uuid, text[][], text[][], integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_mcp_token(text, uuid, uuid, uuid, text[][], text[][], integer, integer, integer) TO service_role;
