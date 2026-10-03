-- Function: public.get_shipment_settings
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:29+01:00

CREATE OR REPLACE FUNCTION public.get_shipment_settings()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_row record;
  v_value jsonb;
  v_defaults jsonb := jsonb_build_object(
    'auto_create_packeta', jsonb_build_object('enabled', false, 'delay_minutes', 0),
    'auto_ship_days', jsonb_build_object('enabled', false, 'days', jsonb_build_array('monday','wednesday','friday')),
    'auto_ship_time', jsonb_build_object('time', '14:00', 'timezone', 'Europe/Prague'),
    'notification_email', jsonb_build_object('email', null, 'send_on_new_order', true, 'send_on_shipment', true),
    'packeta_defaults', jsonb_build_object('default_weight', 0.5, 'default_value', 50, 'sender_name', 'Platform'),
    'shipping_rates', jsonb_build_object(
      'base_currency', public.commerce_base_currency(),
      'methods', jsonb_build_object(
        'packeta_pickup', jsonb_build_object('default', 99, 'by_country', jsonb_build_object()),
        'packeta_home', jsonb_build_object('default', 149, 'by_country', jsonb_build_object()),
        'personal_pickup', jsonb_build_object('default', 0, 'by_country', jsonb_build_object())
      )
    )
  );
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  v_result := v_defaults;

  FOR v_row IN
    SELECT setting_key, setting_value
    FROM public.shipment_settings
    WHERE setting_key IS NOT NULL
  LOOP
    BEGIN
      IF v_row.setting_value IS NULL THEN
        v_value := NULL;
      ELSE
        v_value := v_row.setting_value::jsonb;
      END IF;
    EXCEPTION
      WHEN others THEN
        -- If stored value is not valid JSON, ignore and keep defaults.
        v_value := NULL;
    END;

    IF v_value IS NOT NULL THEN
      v_result := v_result || jsonb_build_object(v_row.setting_key, v_value);
    END IF;
  END LOOP;

  RETURN v_result;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_shipment_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shipment_settings() TO authenticated;
