-- Function: public.calculate_monthly_bottle_allowance
-- Converts max allowed daily drops into monthly bottle count for one product.

CREATE OR REPLACE FUNCTION public.calculate_monthly_bottle_allowance(
  p_user_id uuid,
  p_product_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_daily_drops numeric := 0;
  v_bottle_drops numeric := 0;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_user_id IS NULL OR p_product_id IS NULL THEN
    RETURN 0;
  END IF;

  IF p_user_id <> v_actor_id AND NOT public.is_admin_or_staff(v_actor_id) THEN
    RAISE EXCEPTION 'Insufficient privileges' USING ERRCODE = '42501';
  END IF;

  v_daily_drops := public.calculate_user_product_max_daily_distribution(p_user_id, p_product_id);

  SELECT COALESCE(volume_ml, 30) * COALESCE(drops_per_ml, 22)
  INTO v_bottle_drops
  FROM public.products
  WHERE id = p_product_id;

  IF v_bottle_drops IS NULL OR v_bottle_drops <= 0 THEN
    v_bottle_drops := 600;
  END IF;

  IF v_daily_drops IS NULL OR v_daily_drops <= 0 THEN
    RETURN 0;
  END IF;

  RETURN CEIL((v_daily_drops * 30.0) / v_bottle_drops)::integer;
END;
$function$;

REVOKE ALL ON FUNCTION public.calculate_monthly_bottle_allowance(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.calculate_monthly_bottle_allowance(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.calculate_monthly_bottle_allowance(uuid, uuid) TO authenticated;
