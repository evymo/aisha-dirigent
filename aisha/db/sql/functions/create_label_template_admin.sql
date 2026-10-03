-- Function: public.create_label_template_admin
-- Security: See function definition below.
-- Extracted: 2026-02-08T04:14:52.126Z

CREATE OR REPLACE FUNCTION public.create_label_template_admin(p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_template_id UUID;
  v_template_data JSONB;
  v_product_slug TEXT;
  v_version TEXT;
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admin access required');
  END IF;

  v_template_data := p_data->'template_data';
  v_version := COALESCE(p_data->>'version', '1.0');

  -- Get product slug for key generation
  SELECT slug INTO v_product_slug
  FROM products
  WHERE id = (p_data->>'product_id')::UUID;

  INSERT INTO product_label_templates (
    product_id,
    product_name_key,
    version,
    version_date,
    status,
    description_key,
    composition_key,
    usage_instructions_key,
    registration_number,
    label_pdf_url,
    manufacturer,
    manufacturer_address,
    country_of_origin,
    created_by
  ) VALUES (
    (p_data->>'product_id')::UUID,
    'label.' || COALESCE(v_product_slug, (p_data->>'product_id')::text) || '.v' || v_version || '.product_name',
    v_version,
    CURRENT_DATE,
    COALESCE(p_data->>'status', 'active'),
    'label.' || COALESCE(v_product_slug, (p_data->>'product_id')::text) || '.v' || v_version || '.description',
    'label.' || COALESCE(v_product_slug, (p_data->>'product_id')::text) || '.v' || v_version || '.composition',
    'label.' || COALESCE(v_product_slug, (p_data->>'product_id')::text) || '.v' || v_version || '.usage_instructions',
    v_template_data->>'registration_number',
    v_template_data->>'label_pdf_url',
    v_template_data->>'manufacturer',
    v_template_data->>'manufacturer_address',
    v_template_data->>'country_of_origin',
    auth.uid()
  )
  RETURNING id INTO v_template_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'create'::public.journal_action_type,
      p_area := 'products'::public.journal_area,
      p_details := NULL,
      p_entity_id := v_template_id::text,
      p_entity_type := 'label_template',
      p_new_values := p_data,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Created label template',
      p_tags := ARRAY['admin', 'label_template', 'create'],
      p_user_id := auth.uid()
  );

  RETURN jsonb_build_object('success', true, 'id', v_template_id);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_label_template_admin(p_data jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_label_template_admin(p_data jsonb) TO authenticated;

