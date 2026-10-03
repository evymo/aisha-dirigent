-- Function: public.get_my_product_plans_audited
-- Arguments: none
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_my_product_plans_audited()
 RETURNS TABLE(created_at timestamptz, custom_distribution_instructions text, dose_amount numeric, dose_timing text[], dose_unit text, doses_per_day integer, id uuid, is_active boolean, last_taken_at timestamptz, next_reminder_at timestamptz, notes text, package_quantity integer, protocol_id uuid, protocol_name text, catalog_product_id uuid, catalog_product_name text, remaining_doses numeric, reminder_enabled boolean, reminder_minutes_before integer, reminder_mode text, product_id uuid, product_name text, updated_at timestamptz, user_id uuid, last_distribution_date date, last_distribution_vials integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO audit_journal (user_id, action_type, entity_type, area, severity, summary)
  VALUES (auth.uid(), 'read', 'member_product_plans', 'member', 'info', 'Member viewed product plans');

  RETURN QUERY
  SELECT 
    msp.created_at,
    msp.custom_distribution_instructions,
    msp.dose_amount,
    msp.dose_timing,
    msp.dose_unit,
    msp.doses_per_day,
    msp.id,
    msp.is_active,
    msp.last_taken_at,
    msp.next_reminder_at,
    msp.notes,
    msp.package_quantity,
    msp.protocol_id,
    COALESCE(dp.name, '') as protocol_name,
    msp.catalog_product_id,
    COALESCE(p.name, '') as catalog_product_name,
    msp.remaining_doses,
    msp.reminder_enabled,
    msp.reminder_minutes_before,
    msp.reminder_mode,
    msp.product_id,
    COALESCE(ms.name, '') as product_name,
    msp.updated_at,
    msp.user_id,
    -- Distribution info from user_distribution_schedule
    (SELECT uds.scheduled_date 
     FROM user_distribution_schedule uds 
     WHERE uds.user_id = auth.uid() 
       AND uds.status = 'delivered'
     ORDER BY uds.delivered_at DESC LIMIT 1) as last_distribution_date,
    (SELECT uds.vial_count 
     FROM user_distribution_schedule uds 
     WHERE uds.user_id = auth.uid() 
       AND uds.status = 'delivered'
     ORDER BY uds.delivered_at DESC LIMIT 1) as last_distribution_vials
  FROM member_product_plans msp
  LEFT JOIN distribution_protocols dp ON dp.id = msp.protocol_id
  LEFT JOIN products p ON p.id = msp.catalog_product_id
  LEFT JOIN member_products ms ON ms.id = msp.product_id
  WHERE msp.user_id = auth.uid() AND msp.is_active = true
  ORDER BY msp.created_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_product_plans_audited() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_product_plans_audited() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_product_plans_audited() TO service_role;
