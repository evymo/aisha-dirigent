-- Function: audience_derive_actor_tier
--
-- Public, privacy-guarded tier derivation: only an admin/staff caller, the actor themselves,
-- or an approved consultant may derive (and thereby observe) an actor's tier. Delegates the
-- actual tier computation to audience_compute_actor_tier (the single source of truth, shared
-- with the Brick6 tier-ACL) so the tier rules live in exactly one place.
CREATE OR REPLACE FUNCTION public.audience_derive_actor_tier(p_user_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.audience_user_can_see_creator_stats(p_user_id) THEN
    RAISE EXCEPTION 'Access denied: caller % cannot derive tier for actor %',
      COALESCE(auth.uid()::text, '<anon>'), p_user_id
      USING ERRCODE = '42501';
  END IF;

  RETURN public.audience_compute_actor_tier(p_user_id);
END;
$function$;

REVOKE ALL ON FUNCTION audience_derive_actor_tier(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_derive_actor_tier(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION audience_derive_actor_tier(uuid) TO authenticator;
GRANT EXECUTE ON FUNCTION audience_derive_actor_tier(uuid) TO service_role;
