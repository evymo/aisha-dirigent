-- Function: public.get_token_allocations_admin
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:40+01:00

CREATE OR REPLACE FUNCTION public.get_token_allocations_admin()
 RETURNS TABLE(allocation_name text, allocation_type text, cliff_months integer, distributed_amount numeric, id uuid, is_active boolean, notes text, token_type text, total_amount numeric, updated_at timestamptz, vesting_end timestamptz, vesting_schedule text, vesting_start timestamptz)
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
      p_entity_type := 'token_allocation',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read token allocation',
      p_tags := ARRAY['admin', 'token_allocation'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT 
    ta.allocation_name,
    ta.allocation_type,
    ta.cliff_months,
    ta.distributed_amount,
    ta.id,
    ta.is_active,
    ta.notes,
    ta.token_type,
    ta.total_amount,
    ta.updated_at::text,
    ta.vesting_end::text,
    ta.vesting_schedule,
    ta.vesting_start::text
  FROM token_allocations ta
  ORDER BY ta.updated_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_token_allocations_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_token_allocations_admin() TO authenticated;
