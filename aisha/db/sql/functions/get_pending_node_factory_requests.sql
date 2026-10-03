-- Function: public.get_pending_node_factory_requests
-- Arguments: p_limit integer
-- Description: Get pending/in-progress node factory requests for processing.
-- Security: SECURITY DEFINER with search_path set.
-- Created: 2026-03-05

CREATE OR REPLACE FUNCTION public.get_pending_node_factory_requests(
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  requested_by uuid,
  node_type text,
  node_name text,
  specification jsonb,
  status text,
  error_message text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Authorization: only admin, staff, or service_role
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: only admin or staff can view pending requests'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    nfr.id,
    nfr.requested_by,
    nfr.node_type,
    nfr.node_name,
    nfr.specification,
    nfr.status,
    nfr.error_message,
    nfr.created_at,
    nfr.updated_at
  FROM node_factory_requests nfr
  WHERE nfr.status IN ('pending', 'generating', 'validating', 'testing', 'deploying')
  ORDER BY nfr.created_at ASC
  LIMIT p_limit;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_pending_node_factory_requests(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_node_factory_requests(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_node_factory_requests(integer) TO service_role;
