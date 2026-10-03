-- Function: public.get_user_permissions
-- Arguments: (none)
-- Description: Returns permission codes for current user based on their roles.
--   Uses app_role_permissions table to map roles to permissions.
-- Security: SECURITY DEFINER with search_path set.

CREATE OR REPLACE FUNCTION public.get_user_permissions()
 RETURNS TABLE(permission_code text, category text, role text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  
  -- Use app_role_permissions to get permissions for user's roles
  RETURN QUERY
  SELECT DISTINCT p.code, p.category, ur.role::TEXT
  FROM user_roles ur
  JOIN app_role_permissions arp ON arp.role = ur.role
  JOIN permissions p ON p.id = arp.permission_id
  WHERE ur.user_id = auth.uid()
  ORDER BY p.code;
END;
$function$
;

-- Permissions (PUBLIC: anon users get empty set due to auth.uid() IS NULL guard inside function)
REVOKE ALL ON FUNCTION public.get_user_permissions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_permissions() TO anon;
GRANT EXECUTE ON FUNCTION public.get_user_permissions() TO authenticated;
