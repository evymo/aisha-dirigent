-- Function: public.update_shipment_setting
-- Arguments: p_key text, p_value text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:26+01:00

CREATE OR REPLACE FUNCTION public.update_shipment_setting(p_key text, p_value text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  -- Ensure value is valid JSON (or NULL)
  IF p_value IS NOT NULL THEN
    PERFORM p_value::jsonb;
  END IF;

  INSERT INTO public.shipment_settings (setting_key, setting_value, updated_at)
  VALUES (p_key, p_value, now())
  ON CONFLICT (setting_key)
  DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now();
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_shipment_setting(p_key text, p_value text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_shipment_setting(p_key text, p_value text) TO authenticated;
