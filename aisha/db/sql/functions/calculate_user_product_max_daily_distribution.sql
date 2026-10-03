-- Function: public.calculate_user_product_max_daily_distribution
-- Arguments: p_user_id uuid, p_product_id uuid
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.calculate_user_product_max_daily_distribution(p_user_id uuid, p_product_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_study_max numeric := 0;
  v_subscription_max numeric := 0;
  v_drops_per_ml numeric := 22;
  v_drops_per_spray numeric := 4;
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

  SELECT COALESCE(drops_per_ml, 22)
  INTO v_drops_per_ml
  FROM public.products
  WHERE id = p_product_id;

  SELECT COALESCE(
    MAX(
      CASE
        WHEN dp.dose_unit = 'ml' THEN (dp.dose_amount * v_drops_per_ml) * dp.doses_per_day
        WHEN dp.dose_unit = 'sprays' THEN (dp.dose_amount * v_drops_per_spray) * dp.doses_per_day
        ELSE dp.dose_amount * dp.doses_per_day
      END
    ),
    0
  )
  INTO v_study_max
  FROM public.member_distribution_plans mdp
  JOIN public.study_registrations se ON se.id = mdp.study_registration_id
  JOIN public.study_distribution_protocols dp ON dp.study_id = se.study_id
  JOIN public.studies s ON s.id = se.study_id
  WHERE mdp.user_id = p_user_id
    AND mdp.status = 'active'
    AND s.status = 'active'
    AND dp.product_id = p_product_id
    AND dp.is_active = true;

  SELECT COALESCE(
    MAX((COALESCE(p.volume_ml, 30) * COALESCE(p.drops_per_ml, 22)) / 30.0),
    0
  )
  INTO v_subscription_max
  FROM public.memberships m
  JOIN public.subscription_packages sp ON sp.tier = m.tier
  CROSS JOIN unnest(sp.includes_products) AS included_slug
  JOIN public.products p ON p.slug = included_slug
  WHERE m.user_id = p_user_id
    AND m.status = 'active'
    AND sp.is_active = true
    AND (m.expires_at IS NULL OR m.expires_at >= now())
    AND p.id = p_product_id;

  RETURN GREATEST(v_study_max, v_subscription_max);
END;
$function$;

REVOKE ALL ON FUNCTION public.calculate_user_product_max_daily_distribution(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calculate_user_product_max_daily_distribution(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_user_product_max_daily_distribution(uuid, uuid) TO service_role;
