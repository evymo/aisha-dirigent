-- Function: audience_user_can_see_creator_stats

CREATE OR REPLACE FUNCTION public.audience_user_can_see_creator_stats(p_target_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    is_admin_or_staff()
    OR p_target_user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.study_consultants ra_caller
      JOIN public.study_consultants ra_target
        ON ra_target.scope_type = ra_caller.scope_type
       AND ra_target.study_id = ra_caller.study_id
       AND ra_target.partner_id = p_target_user_id
       AND ra_target.status = 'approved'
      WHERE ra_caller.partner_id = auth.uid()
        AND ra_caller.status = 'approved'
        AND ra_caller.role IN ('communication', 'secretary', 'account_manager')
    );
$function$

;

REVOKE ALL ON FUNCTION audience_user_can_see_creator_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_user_can_see_creator_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION audience_user_can_see_creator_stats(uuid) TO authenticator;
GRANT EXECUTE ON FUNCTION audience_user_can_see_creator_stats(uuid) TO service_role;
