-- ============================================================================
-- Source of Truth: get_agent_publish_detail
-- Purpose: Return the evaluable content of a marketplace agent for the
--          WF_KB_COMPLIANCE_GATE n8n workflow (AISHA compliance review).
--          publish_agent's webhook carries only plugin_id; the workflow needs
--          the full agent content (name, description, capabilities, agent_spec)
--          to evaluate. get_available_plugins can't serve this — it filters
--          status IN ('canary','ga') (excludes 'reviewing') and omits agent_spec.
--
-- Keyed on plugin_catalog.id (the webhook payload field).
-- Security: SECURITY DEFINER, **service_role ONLY** — a 'reviewing' (not yet
-- public) agent's content must not leak to anon/authenticated.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_agent_publish_detail(p_plugin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id',                pc.id,
    'slug',              pc.slug,
    'name',              pc.name,
    'description',       pc.description,
    'kind',              pc.kind::text,
    'status',            pc.status::text,
    'trust_tier',        pc.trust_tier::text,
    'capabilities',      COALESCE(pc.capabilities, '[]'::jsonb),
    'agent_spec',        pc.agent_spec,
    'author_partner_id', pc.author_partner_id
  )
  INTO v_result
  FROM public.plugin_catalog pc
  WHERE pc.id = p_plugin_id AND pc.kind = 'agent';

  RETURN v_result;  -- NULL when not found / not an agent
END;
$$;

COMMENT ON FUNCTION public.get_agent_publish_detail(uuid) IS
  'Full marketplace-agent content for the compliance-gate workflow. service_role only (review content must not leak).';

REVOKE ALL ON FUNCTION public.get_agent_publish_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_agent_publish_detail(uuid) TO service_role;
