-- Function: public.create_member_product_plan_audited
-- Arguments: p_product_id uuid DEFAULT NULL::uuid, p_catalog_product_id uuid DEFAULT NULL::uuid, p_protocol_id uuid DEFAULT NULL::uuid, p_dose_amount numeric DEFAULT 1, p_dose_unit text DEFAULT 'dose'::text, p_doses_per_day integer DEFAULT 1, p_dose_timing text[] DEFAULT ARRAY['morning'::text], p_package_quantity numeric DEFAULT 1, p_reminder_enabled boolean DEFAULT true, p_reminder_minutes_before integer DEFAULT 15, p_custom_distribution_instructions text DEFAULT NULL::text, p_notes text DEFAULT NULL::text
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.create_member_product_plan_audited(p_product_id uuid DEFAULT NULL::uuid, p_catalog_product_id uuid DEFAULT NULL::uuid, p_protocol_id uuid DEFAULT NULL::uuid, p_dose_amount numeric DEFAULT 1, p_dose_unit text DEFAULT 'dose'::text, p_doses_per_day integer DEFAULT 1, p_dose_timing text[] DEFAULT ARRAY['morning'::text], p_package_quantity numeric DEFAULT 1, p_reminder_enabled boolean DEFAULT true, p_reminder_minutes_before integer DEFAULT 15, p_custom_distribution_instructions text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_name text;
  v_protocol_product_id uuid;
  v_doses_per_package numeric;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- If protocol is provided, validate and infer product_id if needed
  IF p_protocol_id IS NOT NULL THEN
    SELECT dp.product_id
      INTO v_protocol_product_id
    FROM distribution_protocols dp
    WHERE dp.id = p_protocol_id
      AND dp.is_active = true;

    IF v_protocol_product_id IS NULL THEN
      RAISE EXCEPTION 'Distribution protocol not found or inactive';
    END IF;

    IF p_catalog_product_id IS NULL THEN
      p_catalog_product_id := v_protocol_product_id;
    ELSIF p_catalog_product_id <> v_protocol_product_id THEN
      RAISE EXCEPTION 'Protocol does not match product';
    END IF;
  END IF;

  -- At least one must be specified
  IF p_product_id IS NULL AND p_catalog_product_id IS NULL THEN
    RAISE EXCEPTION 'Either product_id or catalog_product_id must be specified';
  END IF;

  -- Get name for audit and plan
  IF p_catalog_product_id IS NOT NULL THEN
    SELECT name INTO v_name FROM products WHERE id = p_catalog_product_id;
  ELSE
    SELECT name INTO v_name
    FROM member_products
    WHERE id = p_product_id
      AND (is_public = true OR created_by = v_user_id);
  END IF;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Product or catalog product not found';
  END IF;

  -- Determine doses per package (no fallbacks). If a product is selected, its packaging controls.
  IF p_catalog_product_id IS NOT NULL THEN
    SELECT p.doses_per_package
      INTO v_doses_per_package
    FROM products p
    WHERE p.id = p_catalog_product_id;

    IF v_doses_per_package IS NULL OR v_doses_per_package <= 0 THEN
      RAISE EXCEPTION 'Product doses_per_package must be set and > 0';
    END IF;
  ELSE
    SELECT ms.package_size
      INTO v_doses_per_package
    FROM member_products ms
    WHERE ms.id = p_product_id
      AND (ms.is_public = true OR ms.created_by = v_user_id);

    IF v_doses_per_package IS NULL OR v_doses_per_package <= 0 THEN
      RAISE EXCEPTION 'Product package_size must be set and > 0';
    END IF;
  END IF;

  INSERT INTO member_product_plans (
    user_id, product_id, catalog_product_id, protocol_id, name, dose_amount, dose_unit, doses_per_day, dose_timing,
    package_quantity, reminder_enabled, reminder_minutes_before, custom_distribution_instructions, notes, remaining_doses
  ) VALUES (
    v_user_id, p_product_id, p_catalog_product_id, p_protocol_id, v_name, p_dose_amount, p_dose_unit, p_doses_per_day, p_dose_timing,
    p_package_quantity, p_reminder_enabled, p_reminder_minutes_before, p_custom_distribution_instructions, p_notes,
    p_package_quantity * v_doses_per_package
  )
  RETURNING id INTO v_id;

  -- Increment usage count if community product
  IF p_product_id IS NOT NULL THEN
    UPDATE member_products SET usage_count = usage_count + 1 WHERE id = p_product_id;
  END IF;

  INSERT INTO audit_journal (user_id, action_type, entity_type, entity_id, area, severity, summary)
  VALUES (v_user_id, 'create', 'member_product_plan', v_id::text, 'member', 'info', 
          format('Created product plan for: %s', v_name));

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_member_product_plan_audited(uuid, uuid, uuid, numeric, text, integer, text[][], numeric, boolean, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_member_product_plan_audited(uuid, uuid, uuid, numeric, text, integer, text[][], numeric, boolean, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_member_product_plan_audited(uuid, uuid, uuid, numeric, text, integer, text[][], numeric, boolean, integer, text, text) TO service_role;
