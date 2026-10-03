-- Function: public.update_expedition_on_shipment_change
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:18+01:00

CREATE OR REPLACE FUNCTION public.update_expedition_on_shipment_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Update expedition calendar counts
  UPDATE expedition_calendar ec
  SET 
    confirmed_shipments = (
      SELECT COUNT(*) FROM shipment_records sr 
      WHERE sr.distribution_month = ec.expedition_date 
      AND sr.status IN ('pending', 'packed', 'shipped', 'delivered')
    ),
    packed_shipments = (
      SELECT COUNT(*) FROM shipment_records sr 
      WHERE sr.distribution_month = ec.expedition_date 
      AND sr.status IN ('packed', 'shipped', 'delivered')
    ),
    sent_shipments = (
      SELECT COUNT(*) FROM shipment_records sr 
      WHERE sr.distribution_month = ec.expedition_date 
      AND sr.status IN ('shipped', 'delivered')
    ),
    updated_at = NOW()
  WHERE ec.expedition_date = NEW.distribution_month;
  
  RETURN NEW;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_expedition_on_shipment_change() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_expedition_on_shipment_change() TO authenticated;
