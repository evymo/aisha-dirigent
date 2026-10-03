-- Function: public.get_product_access_level
-- Arguments: p_product_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:19+01:00

CREATE OR REPLACE FUNCTION public.get_product_access_level(p_product_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_has_membership BOOLEAN;
  v_is_partner BOOLEAN;
BEGIN
  -- Check product existence without hydrating unused columns.
  PERFORM 1 FROM public.products WHERE id = p_product_id;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  
  -- Check if user has active membership
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = v_user_id AND status = 'active'
  ) INTO v_has_membership;
  
  -- Check if user is partner
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_user_id AND role IN ('practitioner', 'admin', 'staff')
  ) INTO v_is_partner;
  
  -- Determine access level
  IF v_is_partner THEN
    RETURN 'full_access';
  ELSIF v_has_membership THEN
    RETURN 'member_access';
  ELSE
    RETURN 'public_access';
  END IF;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_product_access_level(p_product_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_access_level(p_product_id uuid) TO authenticated;
