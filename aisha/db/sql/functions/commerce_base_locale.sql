-- Function: public.commerce_base_locale
-- Arguments: (none)
-- Description: Resolves the instance base locale from configuration
--              (system_config key 'commerce_base_locale'). This is the single
--              source of truth for the default locale an AISHA instance falls
--              back to, so a fork whose primary audience is de/fr/th reads its
--              own configured locale instead of inheriting a baked 'cs' literal.
--              Fail-loud: raises if unset -- no hardcoded locale fallback.
-- Security: SECURITY DEFINER - read-only lookup of public instance config.
-- @security: public
-- @audit: none

CREATE OR REPLACE FUNCTION public.commerce_base_locale()
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_locale text;
BEGIN
  SELECT lower(value #>> '{}')
  INTO v_locale
  FROM public.system_config
  WHERE key = 'commerce_base_locale'
  LIMIT 1;

  IF v_locale IS NULL OR v_locale = '' THEN
    RAISE EXCEPTION 'commerce_base_locale is not configured in system_config'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_locale;
END;
$function$
;

-- Permissions: base locale is public instance config; needed by column
-- DEFAULT expressions and by callers that resolve a default locale.
REVOKE ALL ON FUNCTION public.commerce_base_locale() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_base_locale() TO anon;
GRANT EXECUTE ON FUNCTION public.commerce_base_locale() TO authenticated;
GRANT EXECUTE ON FUNCTION public.commerce_base_locale() TO service_role;
