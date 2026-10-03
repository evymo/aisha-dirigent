-- Function: public.get_admin_pending_counts
-- Arguments: (none)
-- Description: Returns counts of all pending admin actions across the system.
--              Used for badges and notifications in the admin activity feed.
-- Security: SECURITY DEFINER; admin/staff guard + audit logging.

CREATE OR REPLACE FUNCTION public.get_admin_pending_counts()
 RETURNS TABLE(
  pending_subscriptions bigint,
  pending_deletions bigint,
  pending_registrations bigint,
  pending_contributions bigint,
  pending_consultants bigint,
  pending_escalations bigint,
  pending_moderation bigint,
  pending_orders bigint
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF NOT public.is_admin_or_staff(v_user_id) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := 'view',
    p_area := 'admin',
    p_details := jsonb_build_object('dataset', 'pending_counts'),
    p_entity_id := NULL,
    p_entity_type := 'admin_pending_counts',
    p_new_values := NULL,
    p_old_values := NULL,
    p_severity := 'notice',
    p_summary := 'Admin viewing pending action counts',
    p_tags := ARRAY['admin', 'pending', 'counts'],
    p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.member_subscriptions WHERE status = 'pending')::bigint AS pending_subscriptions,
    (SELECT COUNT(*) FROM public.account_deletion_requests WHERE status = 'pending')::bigint AS pending_deletions,
    (SELECT COUNT(*) FROM public.study_registrations WHERE status::text IN ('pending', 'screening'))::bigint AS pending_registrations,
    (SELECT COUNT(*) FROM public.study_contributions WHERE status::text = 'pending')::bigint AS pending_contributions,
    (SELECT COUNT(*) FROM public.study_consultants WHERE status::text = 'pending')::bigint AS pending_consultants,
    (SELECT COUNT(*) FROM public.message_escalations WHERE status = 'pending')::bigint AS pending_escalations,
    (SELECT COUNT(*) FROM public.knowledge_moderation_queue WHERE status = 'pending')::bigint AS pending_moderation,
    (SELECT COUNT(*) FROM public.orders WHERE status::text IN ('pending', 'paid', 'processing'))::bigint AS pending_orders;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_admin_pending_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_pending_counts() TO authenticated;

COMMENT ON FUNCTION public.get_admin_pending_counts() IS
'Returns counts of all pending admin actions. Non-sensitive data aggregates for admin dashboard badges.';
