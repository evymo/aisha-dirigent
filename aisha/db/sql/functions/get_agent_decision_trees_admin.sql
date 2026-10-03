-- Function: get_agent_decision_trees_admin

CREATE OR REPLACE FUNCTION public.get_agent_decision_trees_admin(p_agent_slug text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, agent_id uuid, agent_slug text, agent_display_name text, tree_name text, display_name text, description text, trigger_context text, tree_definition jsonb, is_active boolean, version integer, created_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff required';
  END IF;

  RETURN QUERY
  SELECT
    adt.id,
    adt.agent_id,
    ac.slug AS agent_slug,
    ac.display_name AS agent_display_name,
    adt.tree_name,
    adt.display_name,
    adt.description,
    adt.trigger_context,
    adt.tree_definition,
    adt.is_active,
    adt.version,
    adt.created_at
  FROM agent_decision_trees adt
  JOIN agent_catalog ac ON ac.id = adt.agent_id
  WHERE (p_agent_slug IS NULL OR ac.slug = p_agent_slug)
  ORDER BY ac.slug, adt.tree_name;
END;
$function$;

REVOKE ALL ON FUNCTION get_agent_decision_trees_admin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_agent_decision_trees_admin(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_agent_decision_trees_admin(text) TO service_role;
