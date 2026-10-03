CREATE OR REPLACE FUNCTION public.get_keycloak_ids_for_role(p_role text)
RETURNS TABLE(user_id uuid, keycloak_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Auth: service_role access verified by GRANT, extra safety check
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT ur.user_id, i.provider_id::text AS keycloak_id
  FROM user_roles ur
  JOIN auth.identities i
    ON i.user_id = ur.user_id
   AND i.provider = 'keycloak'
  WHERE ur.role = p_role::app_role
  ORDER BY ur.user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_keycloak_ids_for_role(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_keycloak_ids_for_role(text) TO service_role;

COMMENT ON FUNCTION public.get_keycloak_ids_for_role(text) IS
  'Returns Keycloak provider IDs for all users with the given app_role. Used by keycloak-role-sync edge function.';
