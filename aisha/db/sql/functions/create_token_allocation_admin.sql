-- Function: public.create_token_allocation_admin
-- Arguments: p_name text, p_token_type text, p_allocation_amount numeric, p_purpose text, p_vesting_start date, p_vesting_end date
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:18+01:00

CREATE OR REPLACE FUNCTION public.create_token_allocation_admin(p_name text, p_token_type text, p_allocation_amount numeric, p_purpose text, p_vesting_start date DEFAULT NULL::date, p_vesting_end date DEFAULT NULL::date)
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

  INSERT INTO token_allocations (allocation_name, token_type, total_amount, notes, vesting_start, vesting_end)
  VALUES (p_name, p_token_type::token_type, p_allocation_amount, p_purpose, p_vesting_start, p_vesting_end)
  RETURNING row_to_json(token_allocations)::jsonb INTO v_result;

  PERFORM public.write_audit_journal(
      p_action_type := 'create'::public.journal_action_type,
      p_area := 'admin'::public.journal_area,
      p_details := NULL,
      p_entity_id := (v_result->>'id'),
      p_entity_type := 'token_allocation',
      p_new_values := v_result,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Created token allocation: ' || p_name,
      p_tags := ARRAY['admin', 'tokens', 'allocation', 'create'],
      p_user_id := auth.uid()
  );

  RETURN v_result;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_token_allocation_admin(p_name text, p_token_type text, p_allocation_amount numeric, p_purpose text, p_vesting_start date, p_vesting_end date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_token_allocation_admin(p_name text, p_token_type text, p_allocation_amount numeric, p_purpose text, p_vesting_start date, p_vesting_end date) TO authenticated;
