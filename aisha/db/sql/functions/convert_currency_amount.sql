-- Function: public.convert_currency_amount
-- Arguments: p_amount numeric, p_from_currency text, p_to_currency text
-- Description: Helper function to convert currency amounts.
-- Security: Internal helper - used by other functions.
-- @internal: true

CREATE OR REPLACE FUNCTION public.convert_currency_amount(p_amount numeric, p_from_currency text, p_to_currency text)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    CASE
      WHEN p_amount IS NULL THEN NULL
      WHEN p_from_currency IS NULL OR p_to_currency IS NULL THEN NULL
      WHEN upper(p_from_currency) = upper(p_to_currency) THEN p_amount
      ELSE
        p_amount
        * (
          (SELECT cr_to.rate_to_base
           FROM public.currency_rates cr_to
           WHERE cr_to.code = upper(p_to_currency)
             AND cr_to.is_active = true)
          /
          (SELECT cr_from.rate_to_base
           FROM public.currency_rates cr_from
           WHERE cr_from.code = upper(p_from_currency)
             AND cr_from.is_active = true)
        )
    END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.convert_currency_amount(p_amount numeric, p_from_currency text, p_to_currency text) FROM PUBLIC;
-- No GRANT - internal/helper function
