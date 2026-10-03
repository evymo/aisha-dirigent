-- Function: public.commerce_base_currency
-- Arguments: (none)
-- Description: Resolves the instance base fiat currency from configuration
--              (system_config key 'commerce_base_currency'). This is the single
--              source of truth for the currency an AISHA instance transacts in,
--              so a fork in EUR/USD reads its own configured currency instead of
--              inheriting a baked 'CZK' literal. Fail-loud: raises if unset --
--              no hardcoded fiat fallback.
-- Security: SECURITY DEFINER - read-only lookup of public commerce config.
-- @security: public
-- @audit: none

CREATE OR REPLACE FUNCTION public.commerce_base_currency()
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_currency text;
BEGIN
  SELECT upper(value #>> '{}')
  INTO v_currency
  FROM public.system_config
  WHERE key = 'commerce_base_currency'
  LIMIT 1;

  IF v_currency IS NULL OR v_currency = '' THEN
    RAISE EXCEPTION 'commerce_base_currency is not configured in system_config'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_currency;
END;
$function$
;

-- Permissions: base currency is public commerce config; needed by column
-- DEFAULT expressions and by callers that resolve prices.
REVOKE ALL ON FUNCTION public.commerce_base_currency() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_base_currency() TO anon;
GRANT EXECUTE ON FUNCTION public.commerce_base_currency() TO authenticated;
GRANT EXECUTE ON FUNCTION public.commerce_base_currency() TO service_role;
