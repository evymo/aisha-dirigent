-- Function: public.get_product_catalog_admin
-- Arguments: none
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_product_catalog_admin()
 RETURNS TABLE(id uuid, code text, category text, icon text, color text, default_dose_amount numeric, default_dose_unit text, default_doses_per_day integer, default_dose_timing text[], sort_order integer, is_active boolean, created_at timestamptz, updated_at timestamptz, translations jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Authorization: admin or staff
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff role required';
  END IF;


  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'read'::public.journal_action_type,
      p_area := 'products'::public.journal_area,
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'product_catalog',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read product catalog',
      p_tags := ARRAY['admin', 'product_catalog'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    sc.id,
    sc.code,
    sc.category,
    sc.icon,
    sc.color,
    sc.default_dose_amount,
    sc.default_dose_unit,
    sc.default_doses_per_day,
    sc.default_dose_timing,
    sc.sort_order,
    sc.is_active,
    sc.created_at,
    sc.updated_at,
    COALESCE(
      (
        SELECT jsonb_object_agg(sub.locale, sub.trans)
        FROM (
          SELECT
            t.locale,
            jsonb_build_object(
              'name', MAX(CASE WHEN t.key = sc.code || '.name' THEN t.value END),
              'description', MAX(CASE WHEN t.key = sc.code || '.description' THEN t.value END)
            ) AS trans
          FROM translations t
          WHERE t.namespace = 'product_catalog'
            AND t.key LIKE sc.code || '.%'
          GROUP BY t.locale
        ) sub
      ),
      '{}'::jsonb
    ) AS translations
  FROM product_catalog sc
  ORDER BY sc.sort_order, sc.code;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_product_catalog_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_catalog_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_catalog_admin() TO service_role;
