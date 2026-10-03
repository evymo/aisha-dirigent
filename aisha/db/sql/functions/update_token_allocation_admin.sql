-- Function: public.update_token_allocation_admin
-- Arguments: p_id uuid, p_name text, p_allocation_amount numeric, p_purpose text, p_vesting_start date, p_vesting_end date, p_is_active boolean
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:31+01:00

CREATE OR REPLACE FUNCTION public.update_token_allocation_admin(p_id uuid, p_name text DEFAULT NULL::text, p_allocation_amount numeric DEFAULT NULL::numeric, p_purpose text DEFAULT NULL::text, p_vesting_start date DEFAULT NULL::date, p_vesting_end date DEFAULT NULL::date, p_is_active boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  UPDATE token_allocations
  SET 
    allocation_name = COALESCE(p_name, allocation_name),
    total_amount = COALESCE(p_allocation_amount, total_amount),
    notes = COALESCE(p_purpose, notes),
    vesting_start = COALESCE(p_vesting_start, vesting_start),
    vesting_end = COALESCE(p_vesting_end, vesting_end),
    is_active = COALESCE(p_is_active, is_active),
    updated_at = now()
  WHERE id = p_id
  RETURNING row_to_json(token_allocations)::jsonb INTO v_result;


  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'update'::public.journal_action_type,
      p_area := 'tokens'::public.journal_area,
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'token_allocation',
      p_new_values := jsonb_build_object('id', p_id, 'allocation_amount', p_allocation_amount, 'purpose', p_purpose, 'vesting_start', p_vesting_start, 'vesting_end', p_vesting_end),
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Admin updated token allocation',
      p_tags := ARRAY['admin', 'token_allocation', 'update'],
      p_user_id := auth.uid()
  );

  RETURN v_result;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_token_allocation_admin(p_id uuid, p_name text, p_allocation_amount numeric, p_purpose text, p_vesting_start date, p_vesting_end date, p_is_active boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_token_allocation_admin(p_id uuid, p_name text, p_allocation_amount numeric, p_purpose text, p_vesting_start date, p_vesting_end date, p_is_active boolean) TO authenticated;
