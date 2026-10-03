-- Function: public.log_phi_export
-- Arguments: p_export_type text, p_record_count integer, p_format text, p_destination text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:56+01:00

CREATE OR REPLACE FUNCTION public.log_phi_export(p_export_type text, p_record_count integer, p_format text DEFAULT 'json'::text, p_destination text DEFAULT NULL::text)
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
    RAISE EXCEPTION 'Authentication required for sensitive data export';
  END IF;

  IF NOT public.is_admin_or_staff(v_user_id) THEN
    RAISE EXCEPTION 'Admin or staff role required for sensitive data export';
  END IF;

  v_journal_id := public.write_audit_journal(
    p_action_type := 'export'::journal_action_type,
    p_area := 'phi'::journal_area,
    p_details := jsonb_build_object('export_type', p_export_type, 'record_count', p_record_count, 'format', p_format, 'destination', p_destination, 'exported_at', now()),
    p_entity_id := NULL,
    p_entity_type := 'phi_export',
    p_new_values := NULL,
    p_old_values := NULL,
    p_severity := 'critical'::journal_severity,
    p_summary := format('sensitive data export: %s records in %s format', p_record_count, p_format),
    p_tags := ARRAY['phi', 'export', 'audit'],
    p_user_id := NULL
  );

  RETURN v_journal_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.log_phi_export(p_export_type text, p_record_count integer, p_format text, p_destination text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_phi_export(p_export_type text, p_record_count integer, p_format text, p_destination text) FROM anon;
GRANT EXECUTE ON FUNCTION public.log_phi_export(p_export_type text, p_record_count integer, p_format text, p_destination text) TO authenticated;
