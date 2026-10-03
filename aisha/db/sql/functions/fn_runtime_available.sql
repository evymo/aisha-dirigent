-- Function: fn_runtime_available
-- Capability-availability predicate for the runtime axis (E0 — AISHA
-- Orchestration Authority). Given a runtime kind (direct_llm | openclaw |
-- hermes | workflow | human | cli) — and, for kind='cli', a specific CLI slug —
-- answers the single question AISHA asks before dispatching a clow:
--   "Can this platform actually run that runtime right now?"
--
-- AVAILABILITY IS DERIVED, NOT ALLOW-LISTED. A runtime is usable IFF its OWN
-- ai_runtime_registry row is registered + enabled + has a live adapter:
--     row.is_enabled AND row.adapter_health IN ('healthy','unknown')
-- A new runtime (hermes, a new CLI) becomes available simply by self-registering
-- its row + adapter — there is NOTHING to maintain here. This mirrors the
-- provider resolver in aisha_resolve_clow_backend, which filters providers by
--     is_enabled AND last_health_status IN ('healthy','unknown')
-- — capability-availability, not a maintained list of permitted names. The only
-- IN(...) set below is the health-status predicate (a state check), identical to
-- that resolver filter; it is NOT a list of permitted entities.
--
-- DERIVED CHAINING for direct_llm: a 'direct_llm' runtime can only do work if at
-- least one PROVIDER is itself available (same resolver filter), so for that kind
-- we additionally require EXISTS such a provider. Other runtimes
-- (openclaw/hermes/workflow/human/cli) gate solely on their own registry row.
--
-- Runtime slug convention (matches ai_runtime_registry.slug):
--   - kind != 'cli'  → slug = p_runtime_kind            (e.g. 'openclaw')
--   - kind  = 'cli'  → slug = 'cli:' || p_cli_slug      (e.g. 'cli:claude-cli')
--
-- Returns jsonb { available boolean, reason text, row jsonb|null } so callers
-- (orchestrationBridge / admission composer) get both the verdict and the
-- evidence row in one STABLE read.

CREATE OR REPLACE FUNCTION public.fn_runtime_available(
  p_runtime_kind text,
  p_cli_slug text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  -- The registry slug this kind resolves to (single value transform — not a list).
  v_slug    text;
  v_row     public.ai_runtime_registry%ROWTYPE;
  v_found   boolean := false;
  v_provider_ok boolean;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_runtime_kind IS NULL OR p_runtime_kind = '' THEN
    RAISE EXCEPTION 'p_runtime_kind is required';
  END IF;

  -- Derive the registry slug. For 'cli' the specific tool lives in p_cli_slug;
  -- a single composed value, never a maintained set of permitted CLIs.
  IF p_runtime_kind = 'cli' THEN
    IF p_cli_slug IS NULL OR p_cli_slug = '' THEN
      RETURN jsonb_build_object(
        'available', false,
        'reason', 'runtime kind=cli requires a cli_slug',
        'row', NULL
      );
    END IF;
    v_slug := 'cli:' || p_cli_slug;
  ELSE
    v_slug := p_runtime_kind;
  END IF;

  -- Look up the entity's OWN registry row. Not registered → not available.
  SELECT * INTO v_row
  FROM public.ai_runtime_registry rr
  WHERE rr.slug = v_slug;
  v_found := FOUND;

  IF NOT v_found THEN
    RETURN jsonb_build_object(
      'available', false,
      'reason', format('runtime %s is not registered (no ai_runtime_registry row)', v_slug),
      'row', NULL
    );
  END IF;

  -- The entity governs itself: enabled + live adapter. Same health predicate the
  -- provider resolver uses ('healthy','unknown'); a state check, not an allow-list.
  IF NOT v_row.is_enabled THEN
    RETURN jsonb_build_object(
      'available', false,
      'reason', format('runtime %s is registered but disabled (is_enabled=false)', v_slug),
      'row', to_jsonb(v_row)
    );
  END IF;

  IF v_row.adapter_health NOT IN ('healthy', 'unknown') THEN
    RETURN jsonb_build_object(
      'available', false,
      'reason', format('runtime %s adapter is unhealthy (adapter_health=%s)', v_slug, v_row.adapter_health),
      'row', to_jsonb(v_row)
    );
  END IF;

  -- DERIVED chaining: a direct_llm runtime needs at least one available provider.
  -- Mirror the resolver filter exactly (is_enabled AND last_health_status IN
  -- ('healthy','unknown')) — capability-availability, not a provider allow-list.
  IF p_runtime_kind = 'direct_llm' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.ai_provider_registry p
      WHERE p.is_enabled
        AND p.last_health_status IN ('healthy', 'unknown')
    ) INTO v_provider_ok;

    IF NOT v_provider_ok THEN
      RETURN jsonb_build_object(
        'available', false,
        'reason', 'runtime direct_llm has no available provider (none enabled + healthy in ai_provider_registry)',
        'row', to_jsonb(v_row)
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'available', true,
    'reason', format('runtime %s available (enabled, adapter_health=%s)', v_slug, v_row.adapter_health),
    'row', to_jsonb(v_row)
  );
END;
$$;

COMMENT ON FUNCTION public.fn_runtime_available(text, text) IS
  'Capability-availability predicate for the runtime axis. Returns '
  '{available, reason, row}: available IFF the matching ai_runtime_registry row '
  '(slug=p_runtime_kind, or cli:p_cli_slug when kind=cli) is_enabled AND '
  'adapter_health IN (healthy,unknown); for direct_llm ALSO requires an available '
  'provider (mirrors the aisha_resolve_clow_backend resolver filter). Availability '
  'is DERIVED from the registry — no allow-list. STABLE; SECURITY DEFINER.';

REVOKE ALL ON FUNCTION public.fn_runtime_available(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_runtime_available(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_runtime_available(text, text) TO service_role;
