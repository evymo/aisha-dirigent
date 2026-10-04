-- Function: public.edge_subscriptions
-- Purpose: Edge-safe subscription and package operations.

CREATE OR REPLACE FUNCTION public.edge_subscriptions(
  p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_package_id uuid;
  v_row jsonb;
  v_statuses text[];
  v_stripe_subscription_id text;
  v_user_id uuid;
BEGIN
  -- ⛔ SECURITY DEFINER vypíná RLS, takže nárok musí vymáhat tělo. Do 2026-10-04
  -- tu žádná stráž nebyla a funkce má GRANT pro `authenticated` (svc-stripe čte
  -- předplatné uživatelským tokenem): kdokoli přihlášený si přímým
  -- /rpc/edge_subscriptions mohl přepnout VLASTNÍ předplatné na 'active' bez
  -- platby (update_subscription), založit si ho (create_member_subscription),
  -- přepsat Stripe ceny balíčku (update_package_stripe) a číst předplatné cizích
  -- účtů (get_user_subscriptions s cizím user_id).
  -- Zápisy dělá jen služba (svc-stripe po ověření u Stripe / z webhooku); číst
  -- předplatné smí vlastník, služba a správa. Katalog balíčků zůstává čitelný.
  IF p_action IN ('create_member_subscription', 'update_package_stripe', 'update_subscription')
     AND NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  IF p_action = 'create_member_subscription' THEN
    INSERT INTO public.member_subscriptions (
      amount_paid,
      billing_interval_months,
      currency,
      package_id,
      payment_type,
      period_end,
      period_start,
      status,
      user_id
    )
    VALUES (
      NULLIF(p_payload ->> 'amount_paid', '')::numeric,
      NULLIF(p_payload ->> 'billing_interval_months', '')::integer,
      COALESCE(NULLIF(p_payload ->> 'currency', ''), public.commerce_base_currency()),
      NULLIF(p_payload ->> 'package_id', '')::uuid,
      COALESCE(NULLIF(p_payload ->> 'payment_type', ''), 'one_time')::public.payment_type,
      NULLIF(p_payload ->> 'period_end', '')::timestamptz,
      NULLIF(p_payload ->> 'period_start', '')::timestamptz,
      COALESCE(NULLIF(p_payload ->> 'status', ''), 'pending_payment'),
      NULLIF(p_payload ->> 'user_id', '')::uuid
    )
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('id', v_id, 'ok', true);
  END IF;

  IF p_action = 'get_package_by_id' THEN
    v_package_id := NULLIF(p_payload ->> 'package_id', '')::uuid;
    IF v_package_id IS NULL THEN
      RAISE EXCEPTION 'Missing package_id';
    END IF;

    SELECT jsonb_build_object(
      'allow_one_time_payment', p.allow_one_time_payment,
      'allow_recurring_payment', p.allow_recurring_payment,
      'billing_interval_months', p.billing_interval_months,
      'currency', p.currency,
      'description', p.description,
      'governance_tokens', p.governance_tokens,
      'id', p.id,
      'impact_tokens', p.impact_tokens,
      'is_recurring', p.is_recurring,
      'min_billing_months', p.min_billing_months,
      'name', p.name,
      'period', p.period,
      'price', p.price,
      'slug', p.slug,
      'stripe_price_id', p.stripe_price_id,
      'stripe_price_id_one_time', p.stripe_price_id_one_time,
      'stripe_price_id_recurring', p.stripe_price_id_recurring,
      'stripe_product_id', p.stripe_product_id,
      'tier', p.tier
    )
    INTO v_row
    FROM public.subscription_packages p
    WHERE p.id = v_package_id
      AND COALESCE(p.is_active, true) = true
    LIMIT 1;

    RETURN jsonb_build_object('row', v_row);
  END IF;

  IF p_action = 'get_user_subscriptions' THEN
    v_user_id := NULLIF(p_payload ->> 'user_id', '')::uuid;
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'Missing user_id';
    END IF;
    IF v_user_id IS DISTINCT FROM auth.uid()
       AND NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
      RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;

    v_statuses := COALESCE(
      (
        SELECT array_agg(value)
        FROM jsonb_array_elements_text(COALESCE(p_payload -> 'statuses', '[]'::jsonb)) AS t(value)
      ),
      ARRAY[]::text[]
    );

    RETURN jsonb_build_object(
      'rows',
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'cancel_at_period_end', ms.cancel_at_period_end,
              'id', ms.id,
              'next_billing_date', ms.next_billing_date,
              'package', jsonb_build_object(
                'governance_tokens', sp.governance_tokens,
                'impact_tokens', sp.impact_tokens,
                'name', sp.name,
                'period', sp.period,
                'tier', sp.tier
              ),
              'package_id', ms.package_id,
              'payment_type', ms.payment_type,
              'period_end', ms.period_end,
              'period_start', ms.period_start,
              'status', ms.status,
              'stripe_subscription_id', ms.stripe_subscription_id
            )
            ORDER BY ms.created_at DESC
          )
          FROM public.member_subscriptions ms
          LEFT JOIN public.subscription_packages sp ON sp.id = ms.package_id
          WHERE ms.user_id = v_user_id
            AND (
              cardinality(v_statuses) = 0
              OR ms.status = ANY(v_statuses)
            )
        ),
        '[]'::jsonb
      )
    );
  END IF;

  IF p_action = 'update_package_stripe' THEN
    v_package_id := NULLIF(p_payload ->> 'package_id', '')::uuid;
    IF v_package_id IS NULL THEN
      RAISE EXCEPTION 'Missing package_id';
    END IF;

    UPDATE public.subscription_packages
    SET
      stripe_price_id_one_time = CASE WHEN p_payload ? 'stripe_price_id_one_time' THEN NULLIF(p_payload ->> 'stripe_price_id_one_time', '') ELSE stripe_price_id_one_time END,
      stripe_price_id_recurring = CASE WHEN p_payload ? 'stripe_price_id_recurring' THEN NULLIF(p_payload ->> 'stripe_price_id_recurring', '') ELSE stripe_price_id_recurring END,
      stripe_product_id = CASE WHEN p_payload ? 'stripe_product_id' THEN NULLIF(p_payload ->> 'stripe_product_id', '') ELSE stripe_product_id END,
      updated_at = now()
    WHERE id = v_package_id;

    RETURN jsonb_build_object('ok', true, 'updated', FOUND);
  END IF;

  IF p_action = 'update_subscription' THEN
    v_id := NULLIF(p_payload ->> 'id', '')::uuid;
    v_stripe_subscription_id := NULLIF(p_payload ->> 'stripe_subscription_id', '');

    IF v_id IS NULL AND v_stripe_subscription_id IS NULL THEN
      RAISE EXCEPTION 'Missing subscription selector';
    END IF;

    UPDATE public.member_subscriptions
    SET
      cancel_at_period_end = CASE WHEN p_payload ? 'cancel_at_period_end' THEN (p_payload ->> 'cancel_at_period_end')::boolean ELSE cancel_at_period_end END,
      next_billing_date = CASE WHEN p_payload ? 'next_billing_date' THEN NULLIF(p_payload ->> 'next_billing_date', '')::timestamptz ELSE next_billing_date END,
      status = COALESCE(NULLIF(p_payload ->> 'status', ''), status),
      stripe_invoice_id = CASE WHEN p_payload ? 'stripe_invoice_id' THEN NULLIF(p_payload ->> 'stripe_invoice_id', '') ELSE stripe_invoice_id END,
      stripe_payment_intent_id = CASE WHEN p_payload ? 'stripe_payment_intent_id' THEN NULLIF(p_payload ->> 'stripe_payment_intent_id', '') ELSE stripe_payment_intent_id END,
      stripe_subscription_id = CASE WHEN p_payload ? 'new_stripe_subscription_id' THEN NULLIF(p_payload ->> 'new_stripe_subscription_id', '') ELSE stripe_subscription_id END
    WHERE (
      (v_id IS NOT NULL AND id = v_id)
      OR
      (v_id IS NULL AND v_stripe_subscription_id IS NOT NULL AND stripe_subscription_id = v_stripe_subscription_id)
    );

    RETURN jsonb_build_object('ok', true, 'updated', FOUND);
  END IF;

  RAISE EXCEPTION 'Unsupported action: %', p_action;
END;
$function$;

REVOKE ALL ON FUNCTION public.edge_subscriptions(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edge_subscriptions(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.edge_subscriptions(text, jsonb) TO authenticated;
