-- Function: public.get_production_variants_admin
-- Returns production process variants
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.get_production_variants_admin(
  p_product text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  variant_code text,
  variant_name text,
  product text,
  description text,
  process_params jsonb,
  is_active boolean,
  is_default boolean,
  sort_order integer,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := 'read'::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := NULL,
    p_entity_type := 'production_variant',
    p_new_values := jsonb_build_object('product', p_product),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin read production variants',
    p_tags := ARRAY['admin', 'production_variant'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    pv.id, pv.variant_code, pv.variant_name, pv.product,
    pv.description, pv.process_params, pv.is_active,
    pv.is_default, pv.sort_order,
    pv.created_at, pv.updated_at
  FROM public.production_variants pv
  WHERE (p_product IS NULL OR pv.product = p_product)
    AND pv.is_active = true
  ORDER BY pv.product, pv.sort_order, pv.variant_code;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_variants_admin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_variants_admin(text) TO authenticated;
