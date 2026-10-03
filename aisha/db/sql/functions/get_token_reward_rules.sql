-- Function: public.get_token_reward_rules
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:42+01:00

CREATE OR REPLACE FUNCTION public.get_token_reward_rules()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_agg(row_to_json(trr)::jsonb ORDER BY trr.sort_order)
  INTO v_result
  FROM token_reward_rules trr;

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_token_reward_rules() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_token_reward_rules() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_token_reward_rules() TO authenticated;
