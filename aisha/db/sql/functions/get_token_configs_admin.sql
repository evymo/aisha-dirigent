-- Function: public.get_token_configs_admin
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:41+01:00

CREATE OR REPLACE FUNCTION public.get_token_configs_admin()
 RETURNS TABLE(burned_supply numeric, circulating_supply numeric, created_at timestamptz, description text, emission_rate_daily numeric, id uuid, is_active boolean, locked_supply numeric, name text, symbol text, token_type text, total_supply numeric, updated_at timestamptz)
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
      p_entity_type := 'token_config',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read token config',
      p_tags := ARRAY['admin', 'token_config'],
      p_user_id := auth.uid()
  );

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
  ORDER BY tc.token_type;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_token_configs_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_token_configs_admin() TO authenticated;
