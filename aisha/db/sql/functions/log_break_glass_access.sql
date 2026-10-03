-- Function: public.log_break_glass_access
-- Arguments: p_user_user_id uuid, p_reason text, p_entity_type text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:55+01:00

CREATE OR REPLACE FUNCTION public.log_break_glass_access(p_user_user_id uuid, p_reason text, p_entity_type text DEFAULT 'user_data'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_journal_id uuid;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required for break-glass access';
  END IF;

  v_journal_id := public.write_audit_journal(
    p_action_type := 'access'::journal_action_type,
    p_area := 'phi'::journal_area,
    p_details := jsonb_build_object('reason', p_reason, 'user_id', p_user_user_id, 'accessed_at', now()),
    p_entity_id := p_user_user_id::TEXT,
    p_entity_type := p_entity_type,
    p_new_values := NULL,
    p_old_values := NULL,
    p_severity := 'critical'::journal_severity,
    p_summary := 'Break-glass emergency access to user data',
    p_tags := ARRAY['break_glass', 'emergency', 'phi'],
    p_user_id := NULL
  );

  RETURN v_journal_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.log_break_glass_access(p_user_user_id uuid, p_reason text, p_entity_type text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_break_glass_access(p_user_user_id uuid, p_reason text, p_entity_type text) TO authenticated;
