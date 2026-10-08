-- Function: public.upsert_product_catalog_admin
-- Arguments: p_id uuid DEFAULT NULL::uuid, p_code text DEFAULT NULL::text, p_category text DEFAULT 'product'::text, p_icon text DEFAULT '💊'::text, p_color text DEFAULT '#6366f1'::text, p_default_dose_amount numeric DEFAULT NULL::numeric, p_default_dose_unit text DEFAULT NULL::text, p_default_doses_per_day integer DEFAULT NULL::integer, p_default_dose_timing text[] DEFAULT NULL::text[], p_sort_order integer DEFAULT 0, p_is_active boolean DEFAULT true, p_translations jsonb DEFAULT NULL::jsonb
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.upsert_product_catalog_admin(p_id uuid DEFAULT NULL::uuid, p_code text DEFAULT NULL::text, p_category text DEFAULT NULL, p_icon text DEFAULT NULL, p_color text DEFAULT NULL, p_default_dose_amount numeric DEFAULT NULL::numeric, p_default_dose_unit text DEFAULT NULL::text, p_default_doses_per_day integer DEFAULT NULL::integer, p_default_dose_timing text[] DEFAULT NULL::text[], p_sort_order integer DEFAULT NULL, p_is_active boolean DEFAULT NULL, p_translations jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
  v_locale TEXT;
  v_trans JSONB;
  v_action TEXT;
BEGIN
  -- Authorization: admin only
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  IF p_id IS NOT NULL THEN
    -- UPDATE existing
    UPDATE product_catalog SET
      code = COALESCE(p_code, code),
      category = COALESCE(p_category, category),
      icon = COALESCE(p_icon, icon),
      color = COALESCE(p_color, color),
      default_dose_amount = COALESCE(p_default_dose_amount, default_dose_amount),
      default_dose_unit = COALESCE(p_default_dose_unit, default_dose_unit),
      default_doses_per_day = COALESCE(p_default_doses_per_day, default_doses_per_day),
      default_dose_timing = COALESCE(p_default_dose_timing, default_dose_timing),
      sort_order = COALESCE(p_sort_order, sort_order),
      is_active = COALESCE(p_is_active, is_active),
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_id;

    v_action := 'update';
  ELSE
    -- INSERT new
    IF p_code IS NULL THEN
      RAISE EXCEPTION 'Code is required for new catalog entry';
    END IF;

    INSERT INTO product_catalog (
      code, category, icon, color,
      default_dose_amount, default_dose_unit, default_doses_per_day, default_dose_timing,
      sort_order, is_active
    ) VALUES (
      p_code, COALESCE(p_category, 'product'::text), COALESCE(p_icon, '💊'::text), COALESCE(p_color, '#6366f1'::text),
      p_default_dose_amount, p_default_dose_unit, p_default_doses_per_day, p_default_dose_timing,
      COALESCE(p_sort_order, 0), COALESCE(p_is_active, true)
    )
    RETURNING id INTO v_id;

    v_action := 'create';
  END IF;

  -- Upsert translations if provided
  IF p_translations IS NOT NULL AND p_code IS NOT NULL THEN
    FOR v_locale IN SELECT jsonb_object_keys(p_translations) LOOP
      v_trans := p_translations -> v_locale;

      -- Name translation
      IF v_trans ? 'name' THEN
        INSERT INTO translations (locale, namespace, key, value, updated_at)
        VALUES (v_locale, 'product_catalog', p_code || '.name', v_trans->>'name', now())
        ON CONFLICT (locale, namespace, key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = now();
      END IF;

      -- Description translation
      IF v_trans ? 'description' THEN
        INSERT INTO translations (locale, namespace, key, value, updated_at)
        VALUES (v_locale, 'product_catalog', p_code || '.description', v_trans->>'description', now())
        ON CONFLICT (locale, namespace, key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = now();
      END IF;
    END LOOP;
  END IF;

  -- Audit
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'CATALOG_' || upper(v_action),
    jsonb_build_object(
      'area', 'product_catalog',
      'severity', 'info',
      'entity_type', 'product_catalog',
      'entity_id', v_id,
      'code', p_code
    )
  );

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_product_catalog_admin(uuid, text, text, text, text, numeric, text, integer, text[][], integer, boolean, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_product_catalog_admin(uuid, text, text, text, text, numeric, text, integer, text[][], integer, boolean, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_product_catalog_admin(uuid, text, text, text, text, numeric, text, integer, text[][], integer, boolean, jsonb) TO service_role;
