-- Function: get_runtimes_admin
-- Returns ai_runtime_registry rows for the AdminRuntimeRegistry UI — the runtime/
-- executor axis (direct_llm / openclaw / hermes / cli / workflow / human), the
-- co-equal sibling of the provider + model registries. Mirrors
-- get_provider_registry_admin: operators can see which runtimes are enabled +
-- healthy (adapter_health from WF_RUNTIME_HEALTH_PROBE) and their declared
-- capabilities, and toggle is_enabled via update_runtime_admin_audited.
--
-- Admin-or-staff gate via is_admin_or_staff(). Service role bypasses (automation).

CREATE OR REPLACE FUNCTION public.get_runtimes_admin(
  p_runtime_kind text    DEFAULT NULL,
  p_enabled_only boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  runtime_kind text,
  slug text,
  display_name text,
  is_enabled boolean,
  adapter_health text,
  adapter_health_checked_at timestamptz,
  consecutive_failure_count int,
  can_write boolean,
  needs_network boolean,
  supports_tools boolean,
  side_effect_class text,
  autonomy_class text,
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
    r.id,
    r.runtime_kind,
    r.slug,
    r.display_name,
    r.is_enabled,
    r.adapter_health,
    r.adapter_health_checked_at,
    r.consecutive_failure_count,
    r.can_write,
    r.needs_network,
    r.supports_tools,
    r.side_effect_class,
    r.autonomy_class,
    r.notes,
    r.created_at,
    r.updated_at
  FROM ai_runtime_registry r
  WHERE (p_runtime_kind IS NULL OR r.runtime_kind = p_runtime_kind)
    AND (NOT p_enabled_only OR r.is_enabled = true)
  ORDER BY
    -- Enabled first, then by adapter health (healthy → degraded → down → unknown),
    -- then alphabetically by slug — most-relevant runtimes at the top.
    r.is_enabled DESC,
    CASE r.adapter_health
      WHEN 'healthy' THEN 1
      WHEN 'degraded' THEN 2
      WHEN 'down' THEN 3
      ELSE 4
    END,
    r.slug;
END;
$$;

REVOKE ALL ON FUNCTION public.get_runtimes_admin(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_runtimes_admin(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_runtimes_admin(text, boolean) TO service_role;

COMMENT ON FUNCTION public.get_runtimes_admin(text, boolean) IS
  'AdminRuntimeRegistry UI read RPC — ai_runtime_registry rows + adapter_health + declared capabilities (can_write/needs_network/supports_tools) + side_effect/autonomy class. Admin/staff gate. Ordered by is_enabled DESC, health rank, slug.';
