-- Function: public.get_products_public
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:24+01:00

CREATE OR REPLACE FUNCTION public.get_products_public()
 RETURNS TABLE(id uuid, name text, slug text, description text, short_description text, price numeric, compare_at_price numeric, image_url text, images text[], category text, archive_document_id uuid, in_stock boolean, stock_quantity integer, created_at timestamptz, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.name,
    p.slug,
    p.description,
    p.short_description,
    p.price,
    p.compare_at_price,
    p.image_url,
    p.images,
    p.category,
    p.archive_document_id,
    p.in_stock,
    p.stock_quantity,
    p.created_at,
    p.updated_at
  FROM products p
  WHERE p.is_active = true
  ORDER BY p.created_at DESC;
END;
$function$
;

-- Permissions (PUBLIC: produkty jsou veřejné)
REVOKE ALL ON FUNCTION public.get_products_public() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_products_public() TO anon, authenticated, service_role;
