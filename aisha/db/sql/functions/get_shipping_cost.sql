-- Function: public.get_shipping_cost
-- Arguments: p_shipping_method text, p_country text, p_currency text, p_order_subtotal numeric, p_weight_grams integer
-- Description: Calculates shipping cost from shipment_settings with currency conversion.
--   Supports 6 methods, free shipping thresholds, weight surcharges.
-- Security: SECURITY DEFINER - public pricing helper (no sensitive data).

CREATE OR REPLACE FUNCTION public.get_shipping_cost(
  p_shipping_method text,
  p_country text DEFAULT NULL,
  p_currency text DEFAULT NULL,
  p_order_subtotal numeric DEFAULT NULL,
  p_weight_grams integer DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rates jsonb;
  v_method jsonb;
  v_base_currency text := public.commerce_base_currency();
  v_amount_base numeric := 0;
  v_country text := upper(coalesce(p_country, ''));
  v_target_currency text;
  v_free_threshold numeric;
  v_weight_surcharge numeric := 0;
  v_max_weight_kg numeric;
BEGIN
  SELECT setting_value::jsonb
  INTO v_rates
  FROM public.shipment_settings
  WHERE setting_key = 'shipping_rates'
  LIMIT 1;

  IF v_rates IS NULL THEN
    v_rates := jsonb_build_object(
      'base_currency', public.commerce_base_currency(),
      'free_shipping_thresholds', jsonb_build_object(
        'CZ', 1500,
        'SK', 1500,
        'DE', 2000,
        'AT', 2000,
        'PL', 1500
      ),
      'methods', jsonb_build_object(
        'packeta_pickup', jsonb_build_object('default', 89, 'by_country', jsonb_build_object()),
        'packeta_zbox', jsonb_build_object('default', 79, 'by_country', jsonb_build_object()),
        'packeta_home', jsonb_build_object('default', 139, 'by_country', jsonb_build_object()),
        'carrier_pickup', jsonb_build_object('default', 99, 'by_country', jsonb_build_object()),
        'carrier_home', jsonb_build_object('default', 149, 'by_country', jsonb_build_object()),
        'personal_pickup', jsonb_build_object('default', 0, 'by_country', jsonb_build_object())
      )
    );
  END IF;

  v_base_currency := COALESCE(v_rates->>'base_currency', public.commerce_base_currency());

  -- Check free shipping threshold
  IF p_order_subtotal IS NOT NULL AND p_shipping_method <> 'personal_pickup' THEN
    IF v_country <> '' AND (v_rates->'free_shipping_thresholds' ? v_country) THEN
      v_free_threshold := COALESCE(
        NULLIF(v_rates->'free_shipping_thresholds'->>v_country, '')::numeric,
        0
      );
    ELSE
      v_free_threshold := COALESCE(
        NULLIF(v_rates->'free_shipping_thresholds'->>'default', '')::numeric,
        0
      );
    END IF;

    IF v_free_threshold > 0 AND p_order_subtotal >= v_free_threshold THEN
      RETURN 0;
    END IF;
  END IF;

  v_method := v_rates->'methods'->p_shipping_method;

  IF v_method IS NULL THEN
    RETURN 0;
  END IF;

  -- Base price (per country or default)
  IF v_country <> '' AND (v_method->'by_country' ? v_country) THEN
    v_amount_base := COALESCE(NULLIF(v_method->'by_country'->>v_country, '')::numeric, 0);
  ELSE
    v_amount_base := COALESCE(NULLIF(v_method->>'default', '')::numeric, 0);
  END IF;

  -- Weight surcharge (if configured)
  IF p_weight_grams IS NOT NULL AND (v_method ? 'weight_surcharge') THEN
    v_max_weight_kg := COALESCE(NULLIF(v_method->>'max_weight_kg', '')::numeric, 30);
    -- Return -1 to indicate "too heavy" for this method
    IF p_weight_grams > v_max_weight_kg * 1000 THEN
      RETURN -1;
    END IF;

    -- Example: +20 CZK per additional kg over 5kg
    IF p_weight_grams > 5000 AND (v_method ? 'surcharge_per_kg') THEN
      v_weight_surcharge := CEIL((p_weight_grams - 5000)::numeric / 1000)
        * COALESCE(NULLIF(v_method->>'surcharge_per_kg', '')::numeric, 0);
    END IF;
  END IF;

  v_amount_base := v_amount_base + v_weight_surcharge;
  v_target_currency := COALESCE(p_currency, v_base_currency);

  IF upper(v_target_currency) = upper(v_base_currency) THEN
    RETURN v_amount_base;
  END IF;

  RETURN public.convert_currency_amount(v_amount_base, v_base_currency, v_target_currency);
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_shipping_cost(text, text, text, numeric, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shipping_cost(text, text, text, numeric, integer) TO anon, authenticated;
