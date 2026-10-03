-- Function: public.list_custom_nodes
-- Arguments: p_category text, p_active_only boolean
-- Description: List registered custom nodes, optionally filtered by category and active status.
-- Security: SECURITY DEFINER with search_path set.
-- Created: 2026-03-05

CREATE OR REPLACE FUNCTION public.list_custom_nodes(
  p_category text DEFAULT NULL,
  p_active_only boolean DEFAULT true
)
RETURNS TABLE (
  id uuid,
  node_name text,
  display_name text,
  version text,
  description text,
  category text,
  is_active boolean,
  deployed_to_n8n boolean,
  n8n_node_type text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Authorization: authenticated users can list nodes
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authentication required'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    cnr.id,
    cnr.node_name,
    cnr.display_name,
    cnr.version,
    cnr.description,
    cnr.category,
    cnr.is_active,
    cnr.deployed_to_n8n,
    cnr.n8n_node_type,
    cnr.created_at,
    cnr.updated_at
  FROM custom_node_registry cnr
  WHERE
    (p_category IS NULL OR cnr.category = p_category)
    AND (NOT p_active_only OR cnr.is_active = true)
  ORDER BY cnr.node_name, cnr.version DESC;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.list_custom_nodes(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_custom_nodes(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_custom_nodes(text, boolean) TO service_role;
