-- Function: public.get_study_registrations_count_admin
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:36+01:00

CREATE OR REPLACE FUNCTION public.get_study_registrations_count_admin()
 RETURNS TABLE(study_id uuid, total_count bigint, enrolled_count bigint, active_count bigint, completed_count bigint, withdrawn_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;


  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'read'::public.journal_action_type,
      p_area := 'research'::public.journal_area,
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'study_registrations_count',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read study registrations count',
      p_tags := ARRAY['admin', 'study_registrations_count'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT 
    se.study_id,
    COUNT(*)::bigint as total_count,
    COUNT(*) FILTER (WHERE se.status = 'enrolled')::bigint as enrolled_count,
    COUNT(*) FILTER (WHERE se.status = 'active')::bigint as active_count,
    COUNT(*) FILTER (WHERE se.status = 'completed')::bigint as completed_count,
    COUNT(*) FILTER (WHERE se.status = 'withdrawn')::bigint as withdrawn_count
  FROM study_registrations se
  GROUP BY se.study_id
  ORDER BY se.study_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_study_registrations_count_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_study_registrations_count_admin() TO authenticated;
