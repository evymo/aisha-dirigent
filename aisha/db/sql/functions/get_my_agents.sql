-- Function: public.get_my_agents
-- Arguments: none
-- Security: SECURITY DEFINER
-- Description: Partner-scoped reader — the certified guild member's OWN agents
--   (plugin_catalog kind='agent'), in ANY lifecycle status
--   (submitted / reviewing / canary / ga / deprecated / disabled).
--
--   This is the symmetric READ side of submit_plugin + publish_agent. The
--   consumer reader get_available_plugins only returns installable agents
--   (status IN ('canary','ga')) and omits agent_spec, so a partner cannot see
--   their own drafts / in-review agents through it. Mirrors
--   get_my_contributed_rules (the expert-rule analog), scoped to the agent type.
--
--   Returns agent_spec so the partner's edit form can hydrate. Exposing it here
--   is safe: the author_partner_id filter restricts rows to the caller's own
--   agents (no cross-partner leak), unlike get_agent_publish_detail which is
--   service_role only precisely because it is keyed by id with no owner filter.

CREATE OR REPLACE FUNCTION public.get_my_agents()
 RETURNS TABLE(id uuid, slug text, name text, description text, kind text, trust_tier text, status text, capabilities jsonb, agent_spec jsonb, author text, created_at timestamptz, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_partner_id uuid;
BEGIN
  SELECT pp.id INTO v_partner_id
  FROM partner_profiles pp WHERE pp.user_id = auth.uid();

  -- Non-partners (and unauthenticated) own no agents → empty set.
  IF v_partner_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    pc.id, pc.slug, pc.name, pc.description,
    pc.kind::text, pc.trust_tier::text, pc.status::text,
    COALESCE(pc.capabilities, '[]'::jsonb),
    pc.agent_spec, pc.author,
    pc.created_at, pc.updated_at
  FROM plugin_catalog pc
  WHERE pc.kind = 'agent'
    AND pc.author_partner_id = v_partner_id
  ORDER BY pc.updated_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_agents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_agents() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_agents() TO service_role;
