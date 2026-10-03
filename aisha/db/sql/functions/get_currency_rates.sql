-- Function: public.get_currency_rates
-- Arguments: p_locale text
-- Description: Returns active currency rates with localized name. Public lookup data.
-- Security: SECURITY DEFINER - public read-only lookup data.
-- @security: public
-- @audit: none

CREATE OR REPLACE FUNCTION public.get_currency_rates(p_locale text DEFAULT 'en')
 RETURNS TABLE(code text, is_active boolean, is_base boolean, name text, name_native text, rate_to_base numeric, sort_order integer, symbol text, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    cr.code,
    cr.is_active,
    cr.is_base,
    public.get_translation_value_with_fallback(cr.name_key, 'common', p_locale, 'en', NULL) AS name,
    cr.name_native,
    cr.rate_to_base,
    cr.sort_order,
    cr.symbol,
    cr.updated_at
  FROM currency_rates cr
  WHERE cr.is_active = true
  ORDER BY cr.sort_order;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_currency_rates(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_currency_rates(text) TO public;
