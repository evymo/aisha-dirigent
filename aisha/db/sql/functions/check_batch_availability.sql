-- Function: public.check_batch_availability
-- Arguments: p_product_id uuid, p_quantity integer
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:56+01:00

CREATE OR REPLACE FUNCTION public.check_batch_availability(p_product_id uuid, p_quantity integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_available INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_admin_or_staff(v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(SUM(pb.available_units), 0)
  INTO v_available
  FROM production_batches pb
  WHERE pb.product_id = p_product_id
    AND pb.status = 'completed'
    AND (pb.expiry_date IS NULL OR pb.expiry_date > CURRENT_DATE);

  RETURN jsonb_build_object(
    'product_id', p_product_id,
    'requested', p_quantity,
    'available', v_available,
    'sufficient', v_available >= p_quantity,
    'shortage', GREATEST(0, p_quantity - v_available),
    'batches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'batch_id', pb.id,
        'batch_number', pb.batch_number,
        'available_units', pb.available_units,
        'expiry_date', pb.expiry_date
      ))
      FROM production_batches pb
      WHERE pb.product_id = p_product_id
        AND pb.status = 'completed'
        AND pb.available_units > 0
        AND (pb.expiry_date IS NULL OR pb.expiry_date > CURRENT_DATE)
      ORDER BY pb.expiry_date NULLS LAST
    ), '[]'::jsonb)
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.check_batch_availability(p_product_id uuid, p_quantity integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_batch_availability(p_product_id uuid, p_quantity integer) TO authenticated;
