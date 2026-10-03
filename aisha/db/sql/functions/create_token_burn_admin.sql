-- Function: public.create_token_burn_admin
-- Arguments: p_token_type text, p_amount numeric, p_reason text, p_tx_hash text, p_source_user_id uuid, p_description text
-- Description: Create a token burn record. Admin/staff only.
-- Security: SECURITY DEFINER, admin/staff only
-- Updated: 2026-01-09 - Added p_source_user_id and p_description params

CREATE OR REPLACE FUNCTION public.create_token_burn_admin(
  p_token_type text, 
  p_amount numeric, 
  p_reason text, 
  p_tx_hash text DEFAULT NULL,
  p_source_user_id uuid DEFAULT NULL,
  p_description text DEFAULT NULL
)
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

  INSERT INTO token_burns (token_type, amount, burn_reason, burned_by, source_user_id, description)
  VALUES (p_token_type::token_type, p_amount, p_reason, auth.uid(), p_source_user_id, p_description)
  RETURNING row_to_json(token_burns)::jsonb INTO v_result;

  PERFORM public.write_audit_journal(
      p_action_type := 'create'::public.journal_action_type,
      p_area := 'admin'::public.journal_area,
      p_details := NULL,
      p_entity_id := (v_result->>'id'),
      p_entity_type := 'token_burn',
      p_new_values := v_result,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Created token burn: ' || p_amount || ' ' || p_token_type,
      p_tags := ARRAY['admin', 'tokens', 'burn', 'create'],
      p_user_id := auth.uid()
  );

  RETURN v_result;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.create_token_burn_admin(text, numeric, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_token_burn_admin(text, numeric, text, text, uuid, text) TO authenticated;
