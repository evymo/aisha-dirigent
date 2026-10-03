-- Function: public.get_user_app_permissions_with_partner_type
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:46+01:00

CREATE OR REPLACE FUNCTION public.get_user_app_permissions_with_partner_type()
 RETURNS TABLE(permission_code text, permission_name text, category text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_professional boolean;
  v_is_certified_partner boolean;
BEGIN
  -- Check partner status
  SELECT 
    pp.is_production_provider,
    pp.certification_passed_at IS NOT NULL
  INTO v_is_professional, v_is_certified_partner
  FROM public.partner_profiles pp
  WHERE pp.user_id = v_user_id;
  
  -- Return base role permissions
  RETURN QUERY
  SELECT DISTINCT
    p.code,
    p.name,
    p.category
  FROM public.user_roles ur
  JOIN public.app_role_permissions rp ON rp.role = ur.role
  JOIN public.permissions p ON p.id = rp.permission_id
  WHERE ur.user_id = v_user_id
  ORDER BY p.code;
  
  -- Add partner-type-specific permissions if user is certified partner
  IF v_is_certified_partner THEN
    -- Shared partner permissions (both types)
    RETURN QUERY
    SELECT p.code, p.name, p.category
    FROM public.permissions p
    WHERE p.category = 'partner_shared'
    ORDER BY p.code;
    
    IF v_is_professional THEN
      -- Professional partner permissions
      RETURN QUERY
      SELECT p.code, p.name, p.category
      FROM public.permissions p
      WHERE p.category = 'partner_professional'
      ORDER BY p.code;
    ELSE
      -- Amateur partner permissions
      RETURN QUERY
      SELECT p.code, p.name, p.category
      FROM public.permissions p
      WHERE p.category = 'partner_amateur'
      ORDER BY p.code;
    END IF;
  END IF;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_user_app_permissions_with_partner_type() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_app_permissions_with_partner_type() TO authenticated;
