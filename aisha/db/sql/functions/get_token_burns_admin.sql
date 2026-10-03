-- Function: public.get_token_burns_admin
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:40+01:00

CREATE OR REPLACE FUNCTION public.get_token_burns_admin()
 RETURNS TABLE(amount numeric, burn_reason text, burned_by uuid, burned_at timestamptz, description text, id uuid, source_user_id uuid, token_type text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Permission denied: Admin or staff access required';
  END IF;


  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'read'::public.journal_action_type,
      p_area := 'tokens'::public.journal_area,
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'token_burn',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read token burn',
      p_tags := ARRAY['admin', 'token_burn'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT 
    tb.amount,
    tb.burn_reason,
    tb.burned_by,
    tb.burned_at::text,
    tb.description,
    tb.id,
    tb.source_user_id,
    tb.token_type
  FROM token_burns tb
  ORDER BY tb.burned_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_token_burns_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_token_burns_admin() TO authenticated;
