-- Function: public.get_subscription_packages
-- Arguments: p_locale text (default 'en')
-- Description: Returns active subscription packages with localized name/description.
-- Security: SECURITY DEFINER - public read-only pricing data.
-- @security: public
-- @audit: none

-- A currency-suffixed name (`*_usd`) was removed from this function's signature.
-- The TYPES did not change, so CREATE OR REPLACE matches the deployed function and
-- Postgres refuses to rename in place ("cannot change name of input parameter", or
-- "cannot change return type" when the renamed name is a RETURNS TABLE column).
-- DROP-first is the convention used elsewhere in this directory; the REVOKE/GRANT
-- below re-applies whatever privileges the drop clears.
DROP FUNCTION IF EXISTS public.get_subscription_packages(text);

CREATE OR REPLACE FUNCTION public.get_subscription_packages(p_locale text DEFAULT 'en')
 RETURNS TABLE(allow_one_time_payment boolean, allow_recurring_payment boolean, billing_interval_months integer, currency text, description text, governance_tokens integer, id uuid, impact_tokens integer, includes_diagnostics text[], includes_products text[], is_active boolean, is_recurring boolean, min_billing_months integer, name text, period text, price numeric, slug text, sort_order integer, stripe_price_id text, stripe_price_id_one_time text, stripe_price_id_recurring text, stripe_product_id text, tier text, tokens_governance integer, tokens_impact integer, tokens_data integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(sp.allow_one_time_payment, false) AS allow_one_time_payment,
    COALESCE(sp.allow_recurring_payment, COALESCE(sp.is_recurring, false)) AS allow_recurring_payment,
    sp.billing_interval_months,
    sp.currency,
    -- Localized description with fallback
    public.get_translation_value_with_fallback(
      sp.description_key,
      'subscription_packages',
      p_locale,
      'en',
      sp.description
    ) AS description,
    COALESCE(sp.governance_tokens, 0) AS governance_tokens,
    sp.id,
    COALESCE(sp.impact_tokens, 0) AS impact_tokens,
    sp.includes_diagnostics,
    sp.includes_products,
    COALESCE(sp.is_active, true) AS is_active,
    COALESCE(sp.is_recurring, false) AS is_recurring,
    COALESCE(sp.min_billing_months, 1) AS min_billing_months,
    -- Localized name with fallback
    public.get_translation_value_with_fallback(
      sp.name_key,
      'subscription_packages',
      p_locale,
      'en',
      sp.name
    ) AS name,
    sp.period::text,
    sp.price,
    sp.slug,
    COALESCE(sp.sort_order, 0) AS sort_order,
    sp.stripe_price_id,
    sp.stripe_price_id_one_time,
    sp.stripe_price_id_recurring,
    sp.stripe_product_id,
    sp.tier::text,
    sp.tokens_governance,
    sp.tokens_impact,
    sp.tokens_data
  FROM public.subscription_packages sp
  WHERE COALESCE(sp.is_active, true) = true
  ORDER BY COALESCE(sp.sort_order, 0);
END;
$function$
;

-- Permissions (public access for pricing page)
REVOKE ALL ON FUNCTION public.get_subscription_packages(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_subscription_packages(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_subscription_packages(text) TO authenticated;
