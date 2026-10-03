-- Function: public.get_my_subscriptions
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:06+01:00

CREATE OR REPLACE FUNCTION public.get_my_subscriptions()
 RETURNS TABLE(amount_paid numeric, billing_interval_months integer, cancel_at_period_end boolean, created_at timestamptz, currency text, governance_tokens integer, id uuid, impact_tokens integer, next_billing_date timestamptz, package_id uuid, package_name text, package_period text, package_tier text, payment_type text, period_end timestamptz, period_start timestamptz, status text, stripe_subscription_id text, tokens_governance integer, tokens_impact integer, tokens_data integer, user_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    ms.amount_paid,
    ms.billing_interval_months,
    COALESCE(ms.cancel_at_period_end, false) AS cancel_at_period_end,
    ms.created_at,
    ms.currency,
    COALESCE(sp.governance_tokens, 0) AS governance_tokens,
    ms.id,
    COALESCE(sp.impact_tokens, 0) AS impact_tokens,
    ms.next_billing_date,
    ms.package_id,
    sp.name AS package_name,
    sp.period::text AS package_period,
    sp.tier::text AS package_tier,
    ms.payment_type::text AS payment_type,
    ms.period_end,
    ms.period_start,
    ms.status,
    ms.stripe_subscription_id,
    COALESCE(sp.tokens_governance, COALESCE(sp.governance_tokens, 0)) AS tokens_governance,
    COALESCE(sp.tokens_impact, COALESCE(sp.impact_tokens, 0)) AS tokens_impact,
    COALESCE(sp.tokens_data, 0) AS tokens_data,
    ms.user_id
  FROM public.member_subscriptions ms
  LEFT JOIN public.subscription_packages sp ON sp.id = ms.package_id
  WHERE ms.user_id = auth.uid()
  ORDER BY ms.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_subscriptions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_subscriptions() TO authenticated;
