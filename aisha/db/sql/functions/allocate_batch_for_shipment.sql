-- Function: public.allocate_batch_for_shipment
-- Arguments: p_shipment_id uuid, p_product_id uuid, p_quantity integer
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:51+01:00

CREATE OR REPLACE FUNCTION public.allocate_batch_for_shipment(p_shipment_id uuid, p_product_id uuid, p_quantity integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_allocated INTEGER := 0;
  v_batch RECORD;
  v_allocations JSONB := '[]'::jsonb;
  v_remaining INTEGER := p_quantity;
  v_alloc_qty INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_admin_or_staff(v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOR v_batch IN
    SELECT id, batch_number, available_units, expiry_date
    FROM production_batches
    WHERE product_id = p_product_id
      AND status = 'completed'
      AND available_units > 0
      AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE)
    ORDER BY expiry_date NULLS LAST
  LOOP
    IF v_remaining <= 0 THEN
      EXIT;
    END IF;

    v_alloc_qty := LEAST(v_batch.available_units, v_remaining);

    UPDATE production_batches
    SET available_units = available_units - v_alloc_qty,
        updated_at = now()
    WHERE id = v_batch.id;

    v_allocated := v_allocated + v_alloc_qty;
    v_remaining := v_remaining - v_alloc_qty;

    v_allocations := v_allocations || jsonb_build_object(
      'batch_id', v_batch.id,
      'batch_number', v_batch.batch_number,
      'quantity', v_alloc_qty,
      'expiry_date', v_batch.expiry_date,
      'allocated_at', now()
    );
  END LOOP;

  INSERT INTO audit_journal (user_id, action_type, area, entity_type, entity_id, summary, severity)
  VALUES (v_user_id, 'create', 'admin', 'batch_allocation', p_shipment_id::text, 
          format('Allocated %s units for shipment', v_allocated), 'info');

  RETURN jsonb_build_object(
    'success', v_remaining = 0,
    'requested', p_quantity,
    'allocated', v_allocated,
    'remaining', v_remaining,
    'allocations', v_allocations
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.allocate_batch_for_shipment(p_shipment_id uuid, p_product_id uuid, p_quantity integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.allocate_batch_for_shipment(p_shipment_id uuid, p_product_id uuid, p_quantity integer) TO authenticated;
