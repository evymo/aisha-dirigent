-- Function: get_provider_registry_admin
-- Returns ai_provider_registry rows for the AdminProviderRegistry UI.
-- Pairs with the AdminModelRegistry pattern but covers the PROVIDER catalog
-- (anthropic, openai, google-genai, llmgateway-io, ollama, ...) instead of
-- per-model rows.
--
-- After PR #79 (WF_PROVIDER_HEALTH_PROBE), last_health_status is populated
-- by periodic probes — this RPC surfaces that data to the admin UI so
-- operators can see which providers are healthy / degraded / down without
-- writing SQL queries.
--
-- After 20260518190000 (exponential backoff), consecutive_failure_count
-- is exposed too so the UI can show "next probe in ~6h" hints and surface
-- a "reset failure count" affordance for providers stuck on long backoff.
--
-- Admin-or-staff gate via is_admin_or_staff(). Service role bypasses (for
-- automation / n8n inspection workflows).

CREATE OR REPLACE FUNCTION public.get_provider_registry_admin(
  p_backend_kind text    DEFAULT NULL,
  p_enabled_only boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  slug text,
  display_name text,
  backend_kind text,
  endpoint_url text,
  health_url text,
  auth_env_var text,
  auth_kind text,
  supports_chat boolean,
  supports_tool_use boolean,
  supports_vision boolean,
  supports_batch boolean,
  supports_streaming boolean,
  is_enabled boolean,
  last_health_status text,
  last_health_checked_at timestamptz,
  last_health_detail text,
  consecutive_failure_count int,
  cost_class text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
BEGIN
  IF NOT is_admin_or_staff() AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Admin or staff role required' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.slug,
    p.display_name,
    p.backend_kind,
    p.endpoint_url,
    p.health_url,
    p.auth_env_var,
    p.auth_kind,
    p.supports_chat,
    p.supports_tool_use,
    p.supports_vision,
    p.supports_batch,
    p.supports_streaming,
    p.is_enabled,
    p.last_health_status,
    p.last_health_checked_at,
    p.last_health_detail,
    p.consecutive_failure_count,
    p.cost_class,
    p.notes,
    p.created_at,
    p.updated_at
  FROM ai_provider_registry p
  WHERE (p_backend_kind IS NULL OR p.backend_kind = p_backend_kind)
    AND (NOT p_enabled_only OR p.is_enabled = true)
  ORDER BY
    -- Sort enabled providers first, then by health (healthy → degraded → down → unknown),
    -- then alphabetically by slug. Operator sees most-relevant rows at top.
    p.is_enabled DESC,
    CASE p.last_health_status
      WHEN 'healthy' THEN 1
      WHEN 'degraded' THEN 2
      WHEN 'down' THEN 3
      ELSE 4
    END,
    p.slug;
END;
$$;

REVOKE ALL ON FUNCTION public.get_provider_registry_admin(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_provider_registry_admin(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_provider_registry_admin(text, boolean) TO service_role;

COMMENT ON FUNCTION public.get_provider_registry_admin(text, boolean) IS
  'AdminProviderRegistry UI read RPC — full ai_provider_registry rows + health columns + consecutive_failure_count (for backoff visibility). Admin/staff gate. Ordered by is_enabled DESC, health rank, slug.';
