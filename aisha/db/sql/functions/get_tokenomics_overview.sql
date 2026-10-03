-- Function: public.get_tokenomics_overview
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:42+01:00

CREATE OR REPLACE FUNCTION public.get_tokenomics_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  SELECT jsonb_build_object(
    'token_configs', COALESCE((SELECT jsonb_agg(row_to_json(tc)) FROM token_config tc WHERE tc.is_active = true), '[]'::jsonb),
    'transaction_summary', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('token_type', token_type::text, 'transaction_type', transaction_type::text, 'amount', SUM(amount)))
      FROM token_transactions
      GROUP BY token_type, transaction_type
    ), '[]'::jsonb),
    'active_locks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('token_type', token_type::text, 'amount', SUM(amount)))
      FROM token_locks
      WHERE released_at IS NULL AND unlock_date > now()
      GROUP BY token_type
    ), '[]'::jsonb),
    'burn_summary', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('token_type', token_type::text, 'amount', SUM(amount)))
      FROM token_burns
      GROUP BY token_type
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_tokenomics_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tokenomics_overview() TO authenticated;
