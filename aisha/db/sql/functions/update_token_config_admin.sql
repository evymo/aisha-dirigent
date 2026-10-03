-- Function: public.update_token_config_admin
-- Arguments: p_token_type text, p_name text, p_symbol text, p_description text, p_total_supply numeric, p_emission_rate_daily numeric, p_is_active boolean
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:31+01:00

CREATE OR REPLACE FUNCTION public.update_token_config_admin(p_token_type text, p_name text DEFAULT NULL::text, p_symbol text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_total_supply numeric DEFAULT NULL::numeric, p_emission_rate_daily numeric DEFAULT NULL::numeric, p_is_active boolean DEFAULT NULL::boolean)
 RETURNS TABLE(burned_supply numeric, circulating_supply numeric, created_at timestamptz, description text, emission_rate_daily numeric, id uuid, is_active boolean, locked_supply numeric, name text, symbol text, token_type text, total_supply numeric, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Permission denied: Admin or staff access required';
  END IF;

  UPDATE token_config tc
  SET 
    name = COALESCE(p_name, tc.name),
    symbol = COALESCE(p_symbol, tc.symbol),
    description = COALESCE(p_description, tc.description),
    total_supply = COALESCE(p_total_supply, tc.total_supply),
    emission_rate_daily = COALESCE(p_emission_rate_daily, tc.emission_rate_daily),
    is_active = COALESCE(p_is_active, tc.is_active),
    updated_at = now()
  WHERE tc.token_type = p_token_type;

  RETURN QUERY
  SELECT 
    tc.burned_supply,
    tc.circulating_supply,
    tc.created_at::text,
    tc.description,
    tc.emission_rate_daily,
    tc.id,
    tc.is_active,
    tc.locked_supply,
    tc.name,
    tc.symbol,
    tc.token_type,
    tc.total_supply,
    tc.updated_at::text
  FROM token_config tc
  WHERE tc.token_type = p_token_type;

  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'update'::public.journal_action_type,
      p_area := 'tokens'::public.journal_area,
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'token_config',
      p_new_values := jsonb_build_object('token_type', p_token_type, 'symbol', p_symbol, 'description', p_description, 'total_supply', p_total_supply, 'emission_rate_daily', p_emission_rate_daily),
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Admin updated token config',
      p_tags := ARRAY['admin', 'token_config', 'update'],
      p_user_id := auth.uid()
  );

END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_token_config_admin(p_token_type text, p_name text, p_symbol text, p_description text, p_total_supply numeric, p_emission_rate_daily numeric, p_is_active boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_token_config_admin(p_token_type text, p_name text, p_symbol text, p_description text, p_total_supply numeric, p_emission_rate_daily numeric, p_is_active boolean) TO authenticated;
