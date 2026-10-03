-- Function: audience_get_my_tier

CREATE OR REPLACE FUNCTION public.audience_get_my_tier()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'user_id', auth.uid(),
    'member_tier', public.audience_derive_actor_tier(auth.uid()),
    'is_admin_or_staff', is_admin_or_staff(),
    'effective_tier', CASE
      WHEN is_admin_or_staff() THEN 'admin'
      ELSE public.audience_derive_actor_tier(auth.uid())
    END
  );
$function$

;

REVOKE ALL ON FUNCTION audience_get_my_tier() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_get_my_tier() TO authenticated;
GRANT EXECUTE ON FUNCTION audience_get_my_tier() TO authenticator;
GRANT EXECUTE ON FUNCTION audience_get_my_tier() TO service_role;
