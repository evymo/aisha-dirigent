-- Function: public.get_products_admin
-- Arguments: (none)
-- Description: Admin product list with localization keys and marketing content.
-- Security: SECURITY DEFINER, admin/staff only.
-- Updated: 2026-01-24 - Added marketing content columns

CREATE OR REPLACE FUNCTION public.get_products_admin()
RETURNS TABLE(
  archive_document_id uuid,
  category text,
  compare_at_price numeric,
  created_at timestamptz,
  description text,
  description_key text,
  doses_per_package integer,
  id uuid,
  image_url text,
  images text[],
  in_stock boolean,
  name text,
  name_key text,
  price numeric,
  short_description text,
  short_description_key text,
  slug text,
  stock_quantity integer,
  target_audience text,
  updated_at timestamptz,
  use_case text,
  -- Translation metadata + marketing keys
  base_locale text,
  badge_key text,
  tagline_key text,
  image_alt_key text,
  benefits_title_key text,
  composition_title_key text,
  usage_title_key text,
  origin_content jsonb,
  benefits_content jsonb,
  substances_content jsonb,
  usage_content jsonb,
  -- Default protocol
  default_protocol_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  INSERT INTO audit_journal (action, user_id, action_type, entity_type, area, severity, summary)
  VALUES ('GET_PRODUCTS_ADMIN', auth.uid(), 'read'::journal_action_type,
          'products_admin', 'admin'::journal_area, 'info'::journal_severity,
          'Admin viewed products');

  RETURN QUERY
  SELECT
    COALESCE(p.archive_document_id::text, '') as archive_document_id,
    COALESCE(p.category, '') as category,
    COALESCE(p.compare_at_price, 0::numeric(10,2)) as compare_at_price,
    p.created_at,
    COALESCE(p.description, '') as description,
    p.description_key,
    p.doses_per_package,
    p.id,
    COALESCE(p.image_url, '') as image_url,
    COALESCE(p.images, ARRAY[]::text[]) as images,
    COALESCE(p.in_stock, true) as in_stock,
    p.name,
    p.name_key,
    COALESCE(p.price, 0::numeric(10,2)) as price,
    COALESCE(p.short_description, '') as short_description,
    p.short_description_key,
    p.slug,
    COALESCE(p.stock_quantity, 0) as stock_quantity,
    p.target_audience,
    p.updated_at,
    p.use_case,
    -- Translation metadata + marketing keys
    p.base_locale,
    p.badge_key,
    p.tagline_key,
    p.image_alt_key,
    p.benefits_title_key,
    p.composition_title_key,
    p.usage_title_key,
    p.origin_content,
    p.benefits_content,
    p.substances_content,
    p.usage_content,
    p.default_protocol_id
  FROM public.products p
  ORDER BY p.name;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_products_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_products_admin() TO authenticated;
