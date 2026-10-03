-- Function: public.get_admin_health_check_ins_audited
-- Arguments: p_limit integer
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:32+01:00

CREATE OR REPLACE FUNCTION public.get_admin_health_check_ins_audited(p_limit integer DEFAULT 1000)
 RETURNS TABLE(id uuid, user_id uuid, check_in_date date, pain_level integer, energy_level integer, mood_level integer, sleep_quality integer, created_at timestamptz, user_email text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  -- Audit log (using write_audit_journal if available, otherwise direct insert)
  BEGIN
    PERFORM public.write_audit_journal(
        p_action_type := 'read'::journal_action_type,
        p_area := 'admin'::journal_area,
        p_entity_id := NULL,
        p_entity_type := 'health_check_ins',
        p_severity := 'info'::journal_severity,
        p_summary := 'Admin viewed health check-ins',
    p_user_id := auth.uid()
  );
  EXCEPTION WHEN undefined_function OR invalid_parameter_value THEN
    -- Fallback: direct insert with correct column names
    INSERT INTO public.audit_journal (user_id, action, entity_type, metadata, created_at)
    VALUES (
      auth.uid(),
      'read',
      'health_check_ins',
      jsonb_build_object('area', 'admin', 'summary', 'Admin viewed health check-ins'),
      now()
    );
  END;

  RETURN QUERY
  SELECT 
    hc.id,
    hc.user_id,
    hc.check_in_date,
    hc.pain_level,
    hc.energy_level,
    hc.mood_level,
    hc.sleep_quality,
    hc.created_at,
    au.email::text AS user_email
  FROM public.health_check_ins hc
  LEFT JOIN aisha_auth.users au ON au.id = hc.user_id
  ORDER BY hc.created_at DESC
  LIMIT p_limit;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_admin_health_check_ins_audited(p_limit integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_admin_health_check_ins_audited(p_limit integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_admin_health_check_ins_audited(p_limit integer) TO authenticated;
