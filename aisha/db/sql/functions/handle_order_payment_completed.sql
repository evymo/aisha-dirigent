-- Function: public.handle_order_payment_completed
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:51+01:00

CREATE OR REPLACE FUNCTION public.handle_order_payment_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_auto_create JSONB;
  v_schedule_id UUID;
  v_schedule_date DATE;
BEGIN
  -- Only trigger on status change to 'paid'
  IF NEW.status = 'paid' AND (OLD.status IS NULL OR OLD.status != 'paid') THEN
    
    -- Check if auto-create is enabled
    SELECT value INTO v_auto_create
    FROM public.shipment_settings
    WHERE key = 'auto_create_packeta';
    
    -- If auto-create is enabled and shipping is not personal pickup
    IF v_auto_create->>'enabled' = 'true' AND NEW.shipping_method != 'personal_pickup' THEN
      -- Find or create today's distribution schedule
      v_schedule_date := CURRENT_DATE;
      
      SELECT id INTO v_schedule_id
      FROM public.distribution_schedule
      WHERE scheduled_date = v_schedule_date
      AND status = 'pending';
      
      IF v_schedule_id IS NULL THEN
        INSERT INTO public.distribution_schedule (scheduled_date, orders_count)
        VALUES (v_schedule_date, 1)
        RETURNING id INTO v_schedule_id;
      ELSE
        UPDATE public.distribution_schedule
        SET orders_count = orders_count + 1
        WHERE id = v_schedule_id;
      END IF;
      
      -- Add order to schedule
      INSERT INTO public.distribution_schedule_orders (schedule_id, order_id)
      VALUES (v_schedule_id, NEW.id)
      ON CONFLICT (schedule_id, order_id) DO NOTHING;
    END IF;
    
    -- Log the payment event.
    -- ⛔ p_resource_id je TEXT. Dřív tu šlo holé NEW.id (uuid) a uuid nemá implicitní
    -- přetypování na text — Postgres funkci nenašel a KAŽDÝ přechod objednávky na
    -- 'paid' (webhook Stripe, párování bankovní platby) spadl celý, včetně zápisu,
    -- který ho vyvolal.
    PERFORM public.record_audit_log(
      'order_paid',
      'orders',
      NEW.id::text,
      NULL,
      jsonb_build_object('total', NEW.total, 'shipping_method', NEW.shipping_method)
    );
  END IF;
  
  RETURN NEW;
END;
$function$
;

-- Trigger function: REVOKE to prevent direct invocation
REVOKE ALL ON FUNCTION public.handle_order_payment_completed() FROM PUBLIC;
