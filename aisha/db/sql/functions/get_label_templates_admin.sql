-- Function: public.get_label_templates_admin
-- Security: See function definition below.
-- Extracted: 2026-02-08T04:14:53.603Z

CREATE OR REPLACE FUNCTION public.get_label_templates_admin()
 RETURNS TABLE(id uuid, product_id uuid, product_name text, product_slug text, version text, version_date timestamptz, status text, product_name_key text, description_key text, composition_key text, usage_instructions_key text, manufacturer text, manufacturer_address text, country_of_origin text, registration_number text, label_pdf_url text, created_at timestamptz, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;


  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'read'::public.journal_action_type,
      p_area := 'products'::public.journal_area,
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'label_template',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read label template',
      p_tags := ARRAY['admin', 'label_template'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    t.id,
    t.product_id,
    p.name,
    p.slug,
    t.version,
    t.version_date,
    t.status,
    COALESCE(t.product_name_key, '') AS product_name_key,
    COALESCE(t.description_key, '') AS description_key,
    COALESCE(t.composition_key, '') AS composition_key,
    COALESCE(t.usage_instructions_key, '') AS usage_instructions_key,
    t.manufacturer,
    t.manufacturer_address,
    t.country_of_origin,
    t.registration_number,
    t.label_pdf_url,
    t.created_at,
    t.updated_at
  FROM product_label_templates t
  LEFT JOIN products p ON p.id = t.product_id
  ORDER BY t.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_label_templates_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_label_templates_admin() TO authenticated;

