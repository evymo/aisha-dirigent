-- Function: public.create_member_product_audited
-- Arguments: p_name text, p_description text DEFAULT NULL::text, p_category text DEFAULT 'product'::text, p_default_dose_amount numeric DEFAULT NULL::numeric, p_default_dose_unit text DEFAULT NULL::text, p_default_doses_per_day integer DEFAULT NULL::integer, p_default_dose_timing text[] DEFAULT NULL::text[], p_package_size numeric DEFAULT NULL::numeric, p_package_unit text DEFAULT NULL::text, p_is_public boolean DEFAULT false
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.create_member_product_audited(p_name text, p_description text DEFAULT NULL::text, p_category text DEFAULT 'product'::text, p_default_dose_amount numeric DEFAULT NULL::numeric, p_default_dose_unit text DEFAULT NULL::text, p_default_doses_per_day integer DEFAULT NULL::integer, p_default_dose_timing text[] DEFAULT NULL::text[], p_package_size numeric DEFAULT NULL::numeric, p_package_unit text DEFAULT NULL::text, p_is_public boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO member_products (
    created_by, name, description, category, 
    default_dose_amount, default_dose_unit, default_doses_per_day, default_dose_timing,
    package_size, package_unit, is_public
  ) VALUES (
    v_user_id, p_name, p_description, p_category,
    p_default_dose_amount, p_default_dose_unit, p_default_doses_per_day, p_default_dose_timing,
    p_package_size, p_package_unit, p_is_public
  )
  RETURNING id INTO v_id;

  INSERT INTO audit_journal (user_id, action_type, entity_type, entity_id, area, severity, summary)
  VALUES (v_user_id, 'create', 'member_product', v_id::text, 'member', 'info', 
          format('Created product: %s', p_name));

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_member_product_audited(text, text, text, numeric, text, integer, text[][], numeric, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_member_product_audited(text, text, text, numeric, text, integer, text[][], numeric, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_member_product_audited(text, text, text, numeric, text, integer, text[][], numeric, text, boolean) TO service_role;
