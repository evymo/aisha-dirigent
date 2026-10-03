-- Function: public.is_certified_partner
-- Arguments: p_user_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:53+01:00

CREATE OR REPLACE FUNCTION public.is_certified_partner(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 
    FROM public.partner_profiles pp
    WHERE pp.user_id = COALESCE(p_user_id, auth.uid())
    AND pp.certification_passed_at IS NOT NULL
  );
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.is_certified_partner(p_user_id uuid) FROM PUBLIC;
-- Granted to authenticated: read-only cert predicate (certified partners are
-- already publicly listed via get_certified_partners). Lets the agent-marketplace
-- UI gate the publish flow, and lets submit_plugin gate publishing to certified
-- guild members. Low sensitivity — returns only a boolean.
GRANT EXECUTE ON FUNCTION public.is_certified_partner(p_user_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_certified_partner(p_user_id uuid) TO service_role;
