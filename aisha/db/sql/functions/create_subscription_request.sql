-- Function: public.create_subscription_request
-- Arguments: p_package_id uuid, p_amount_paid numeric, p_period_start timestamp with time zone, p_period_end timestamp with time zone, p_currency text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:17+01:00

CREATE OR REPLACE FUNCTION public.create_subscription_request(
  p_package_id uuid,
  p_amount_paid numeric,
  p_period_start timestamp with time zone,
  p_period_end timestamp with time zone,
  p_currency text DEFAULT public.commerce_base_currency()
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_subscription_id uuid;
  v_pkg public.subscription_packages%ROWTYPE;
  v_amount numeric;
  v_currency text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Only real, purchasable packages.
  SELECT * INTO v_pkg FROM public.subscription_packages WHERE id = p_package_id;
  IF NOT FOUND OR NOT v_pkg.is_active THEN
    RAISE EXCEPTION 'Subscription package not available';
  END IF;

  -- Server-authoritative pricing: the price comes from the package, never from the
  -- client. p_amount_paid/p_currency are ignored to prevent a client from booking a
  -- paid tier at an arbitrary amount. (Eligibility is enforced at admin activation,
  -- so a founding/grandfathered member can still request; the request stays 'pending'.)
  v_amount := v_pkg.price;
  v_currency := upper(coalesce(v_pkg.currency, p_currency, public.commerce_base_currency()));

  INSERT INTO member_subscriptions (
    user_id,
    package_id,
    amount_paid,
    currency,
    status,
    period_start,
    period_end
  ) VALUES (
    v_user_id,
    p_package_id,
    v_amount,
    v_currency,
    'pending',
    p_period_start,
    p_period_end
  )
  RETURNING id INTO v_subscription_id;

  RETURN v_subscription_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_subscription_request(p_package_id uuid, p_amount_paid numeric, p_period_start timestamp with time zone, p_period_end timestamp with time zone, p_currency text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_subscription_request(p_package_id uuid, p_amount_paid numeric, p_period_start timestamp with time zone, p_period_end timestamp with time zone, p_currency text) TO authenticated;
