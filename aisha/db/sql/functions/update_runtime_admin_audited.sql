-- Function: update_runtime_admin_audited
-- Operator toggle + adapter self-register setter for ai_runtime_registry — the
-- capability-availability source-of-truth for AISHA's `runtime` axis (direct_llm
-- | openclaw | hermes | workflow | human | cli). Mirrors update_provider_admin.
--
-- AVAILABILITY IS DERIVED, NOT ALLOW-LISTED. AISHA treats a runtime as usable
-- iff its OWN row is REGISTERED + is_enabled + has a healthy registered adapter
-- (adapter_health). There is NO maintained list of "permitted runtimes"
-- anywhere: a new runtime (e.g. hermes, cli) self-registers by writing its own
-- row, exactly as a provider self-registers in ai_provider_registry. This RPC
-- is the write seam for that — it mutates the SINGLE row keyed by slug and
-- touches ONLY the fields the caller supplied.
--
-- Two caller classes, one entry point:
--   * admin/staff   — operator UI toggle (enable/disable, override health).
--   * service_role  — the adapter itself, self-registering its liveness +
--                     declared capabilities on boot / health-probe (no human in
--                     the loop, so a service-context call must be allowed).
--
-- p_caps is the runtime's OWN declared-capability bag (e.g.
-- {"needs_write": true, "supports_tools": true}), the runtime-axis analogue of
-- the per-provider supports_* flags. It is SHALLOW-MERGED into the existing caps
-- so an adapter can re-declare a subset without clobbering the rest. This is a
-- self-governed capability descriptor, NOT a roster of permitted entities — the
-- clow's needs are matched against these declared caps at decision time
-- (capability-match is derived), never against a hand-maintained allow-list.
--
-- adapter_health mirrors ai_provider_registry.last_health_status semantics
-- ('healthy' | 'degraded' | 'down' | 'unknown'); the registry table's CHECK
-- constraint enforces the domain, so an out-of-range value fails loud here.
--
-- Audits via audit_journal action='runtime_admin_updated' so operator + adapter
-- mutations of the runtime catalog are visible. Returns the row id (uuid).

CREATE OR REPLACE FUNCTION public.update_runtime_admin_audited(
  p_slug          text,
  p_is_enabled    boolean DEFAULT NULL,
  p_adapter_health text   DEFAULT NULL,
  p_caps          jsonb   DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service     boolean;
  v_id             uuid;
  v_old_enabled    boolean;
  v_old_health     text;
BEGIN
  -- admin/staff (operator UI) OR service_role (adapter self-register).
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required' USING ERRCODE = '22023';
  END IF;

  IF p_slug IS NULL OR btrim(p_slug) = '' THEN
    RAISE EXCEPTION 'p_slug required' USING ERRCODE = '22023';
  END IF;

  SELECT id, is_enabled, adapter_health
    INTO v_id, v_old_enabled, v_old_health
  FROM   public.ai_runtime_registry
  WHERE  slug = p_slug
  FOR    UPDATE;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Runtime not found: %', p_slug USING ERRCODE = '22023';
  END IF;

  -- Only-provided-fields update. p_caps is shallow-merged into the metadata jsonb
  -- (self-declared subset never clobbers sibling keys). NOTE: ai_runtime_registry
  -- has NO `caps` column — the declared capabilities are the individual can_write/
  -- needs_network/supports_tools booleans; freeform overrides live in metadata. The
  -- old `caps` reference made this RPC (the admin enable/disable toggle) fail at
  -- parse time with "column caps does not exist" for EVERY call.
  UPDATE public.ai_runtime_registry
  SET    is_enabled     = COALESCE(p_is_enabled, is_enabled),
         adapter_health = COALESCE(p_adapter_health, adapter_health),
         metadata       = CASE WHEN p_caps IS NULL THEN metadata ELSE metadata || p_caps END,
         updated_at     = now()
  WHERE  id = v_id;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'runtime_admin_updated',
    jsonb_build_object(
      'area',              'ai',
      'severity',          'info',
      'entity_type',       'ai_runtime_registry',
      'entity_id',         v_id::text,
      'slug',              p_slug,
      'via_service_role',  v_is_service,
      'old_is_enabled',    v_old_enabled,
      'new_is_enabled',    COALESCE(p_is_enabled, v_old_enabled),
      'enabled_changed',   (p_is_enabled IS NOT NULL AND p_is_enabled IS DISTINCT FROM v_old_enabled),
      'old_adapter_health', v_old_health,
      'new_adapter_health', COALESCE(p_adapter_health, v_old_health),
      'caps_changed',      (p_caps IS NOT NULL)
    )
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_runtime_admin_audited(text, boolean, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_runtime_admin_audited(text, boolean, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_runtime_admin_audited(text, boolean, text, jsonb) TO service_role;

COMMENT ON FUNCTION public.update_runtime_admin_audited(text, boolean, text, jsonb) IS
  'Capability-availability write seam for ai_runtime_registry. Updates the single row by slug (only provided fields; caps shallow-merged). Admin/staff (operator UI) OR service_role (adapter self-register). Audits via audit_journal action=runtime_admin_updated. Returns row id. No allow-list — availability is derived from the row''s own is_enabled + adapter_health + declared caps. Mirrors update_provider_admin.';
