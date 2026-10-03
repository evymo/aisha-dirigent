-- ============================================================================
-- Source of Truth: materialize_agent_runtime
-- Purpose: Turn an APPROVED declarative marketplace agent (plugin_catalog
--          kind='agent', with agent_spec) into a routable runtime identity:
--          one idempotent agent_catalog row + its global expert_rule bindings.
--          After this, route_task can route to the agent's slug (call-mode) and
--          mcp_get_agent_knowledge surfaces its rules.
--
-- Called from the approve gates (fn_aisha_kb_decision / review_moderation_item
-- agent branches) in the same txn that flips plugin_catalog.status → 'canary',
-- so the catalog row lands atomically with approval — no orphan window.
--
-- Idempotent: re-approve / canary→ga converge on exactly one catalog row +
-- one set of global rule bindings. Executable agents (agent_spec IS NULL,
-- Phase 2) are skipped. A marketplace agent can NEVER overwrite a built-in
-- system agent (source_plugin_id IS NULL) — the ON CONFLICT guard refuses it.
-- Security: SECURITY DEFINER, service_role only (called from service-context gates).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.materialize_agent_runtime(p_plugin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pc            record;
  v_spec          jsonb;
  v_model         text;
  v_catalog_id    uuid;
  v_rule_slug     text;
  v_rule_id       uuid;
  v_binding_count int := 0;
  v_audit_user    uuid;
BEGIN
  SELECT id, slug, name, description, agent_spec, kind, author_partner_id
    INTO v_pc
    FROM public.plugin_catalog
   WHERE id = p_plugin_id;

  IF v_pc.id IS NULL THEN
    RAISE EXCEPTION 'Plugin not found: %', p_plugin_id USING ERRCODE = 'P0002';
  END IF;
  IF v_pc.kind <> 'agent' THEN
    RAISE EXCEPTION 'Plugin % is not an agent', p_plugin_id USING ERRCODE = 'P0002';
  END IF;

  v_spec := v_pc.agent_spec;
  -- Declarative agents only. Executable/call-mode agents carry no agent_spec
  -- (Phase 2 — runner-based execution, not a route_task persona).
  IF v_spec IS NULL THEN
    RETURN jsonb_build_object('skipped', 'no agent_spec (executable/call-mode)', 'agent_slug', v_pc.slug);
  END IF;

  -- default_model MUST be a router model KEY (the router maps it to a provider
  -- model); marketplace authors may not pin raw provider ids. Coerce unknowns.
  v_model := COALESCE(v_spec->>'default_model', 'balanced');
  IF v_model NOT IN ('fast', 'balanced', 'maxQuality') THEN
    v_model := 'balanced';
  END IF;

  -- Upsert the runtime row, keyed on slug. The WHERE guard means a conflict on
  -- a row we don't own (a system agent with source_plugin_id IS NULL, or another
  -- plugin's row) does NOT update → RETURNING NULL → we refuse below.
  INSERT INTO public.agent_catalog (
    slug, display_name, purpose, default_model, model_overrides,
    allowed_tools, denied_tools, default_context_profile, max_loops,
    safety_level, autonomy_level, is_active, source_plugin_id
  ) VALUES (
    v_pc.slug,
    COALESCE(v_pc.name, 'Agent: ' || v_pc.slug),
    COALESCE(v_spec->>'purpose', v_pc.description, 'Marketplace agent'),
    v_model,
    COALESCE(v_spec->'model_overrides', '{}'::jsonb),
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_spec->'allowed_tools', '[]'::jsonb))),
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_spec->'denied_tools', '[]'::jsonb))),
    COALESCE(v_spec->>'context_profile', 'repo_plus_rules'),
    COALESCE((v_spec->>'max_loops')::int, 3),
    COALESCE(v_spec->>'safety_level', 'standard'),
    COALESCE(v_spec->>'autonomy_level', 'semi'),
    true,
    p_plugin_id
  )
  ON CONFLICT (slug) DO UPDATE SET
    display_name            = EXCLUDED.display_name,
    purpose                 = EXCLUDED.purpose,
    default_model           = EXCLUDED.default_model,
    model_overrides         = EXCLUDED.model_overrides,
    allowed_tools           = EXCLUDED.allowed_tools,
    denied_tools            = EXCLUDED.denied_tools,
    default_context_profile = EXCLUDED.default_context_profile,
    max_loops               = EXCLUDED.max_loops,
    safety_level            = EXCLUDED.safety_level,
    autonomy_level          = EXCLUDED.autonomy_level,
    is_active               = true,
    source_plugin_id        = p_plugin_id,
    updated_at              = now()
  WHERE public.agent_catalog.source_plugin_id = p_plugin_id
  RETURNING id INTO v_catalog_id;

  IF v_catalog_id IS NULL THEN
    RAISE EXCEPTION 'Agent slug % collides with a built-in/other agent — refusing to overwrite', v_pc.slug
      USING ERRCODE = '42501';
  END IF;

  -- Rebuild this agent's GLOBAL rule bindings from agent_spec.rule_slugs
  -- (idempotent re-derive). Direct insert — set_agent_knowledge_binding_audited
  -- is admin-gated and would reject the service-context caller.
  --
  -- Delete ONLY the active rows we own — a binding an operator soft-disabled
  -- (is_active=false) is deliberately left intact so a canary→ga (or any
  -- re-)materialization never silently resurrects it.
  DELETE FROM public.agent_knowledge_bindings
   WHERE agent_slug = v_pc.slug AND story_id IS NULL AND binding_type = 'rule'
     AND is_active = true;

  FOR v_rule_slug IN
    SELECT jsonb_array_elements_text(COALESCE(v_spec->'rule_slugs', '[]'::jsonb))
  LOOP
    SELECT id INTO v_rule_id
      FROM public.expert_rules
     WHERE slug = v_rule_slug AND status = 'published'
     LIMIT 1;
    -- Insert only if no binding remains for this rule — i.e. skip rules an
    -- operator soft-disabled (their is_active=false row survived the DELETE),
    -- so re-materialization respects the kill of an individual binding.
    IF v_rule_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.agent_knowledge_bindings
          WHERE agent_slug = v_pc.slug AND knowledge_item_id = v_rule_id
            AND story_id IS NULL AND binding_type = 'rule'
       )
    THEN
      INSERT INTO public.agent_knowledge_bindings
        (agent_slug, knowledge_item_id, binding_type, priority, is_active, story_id, notes)
      VALUES
        (v_pc.slug, v_rule_id, 'rule', 100, true, NULL, 'materialized from marketplace agent');
      v_binding_count := v_binding_count + 1;
    END IF;
    -- stale/unpublished slugs are skipped, never fatal
  END LOOP;

  -- Audit (service context: auth.uid() may be NULL → fall back to the author;
  -- NULL is FK-safe per audit-journal-actor-no-fk-sentinel gate).
  v_audit_user := auth.uid();
  IF v_audit_user IS NULL AND v_pc.author_partner_id IS NOT NULL THEN
    SELECT pp.user_id INTO v_audit_user
      FROM public.partner_profiles pp WHERE pp.id = v_pc.author_partner_id;
  END IF;
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (v_audit_user, 'AGENT_RUNTIME_MATERIALIZED', jsonb_build_object(
    'area', 'marketplace', 'severity', 'info',
    'plugin_id', p_plugin_id, 'agent_slug', v_pc.slug,
    'catalog_id', v_catalog_id, 'binding_count', v_binding_count,
    'default_model', v_model
  ));

  RETURN jsonb_build_object(
    'agent_slug', v_pc.slug,
    'catalog_id', v_catalog_id,
    'binding_count', v_binding_count
  );
END;
$$;

COMMENT ON FUNCTION public.materialize_agent_runtime(uuid) IS
  'Materialize an approved declarative marketplace agent into a routable agent_catalog row + rule bindings. Idempotent; service_role only.';

REVOKE ALL ON FUNCTION public.materialize_agent_runtime(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.materialize_agent_runtime(uuid) TO service_role;
