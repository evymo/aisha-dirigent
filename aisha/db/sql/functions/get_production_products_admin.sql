-- Function: public.get_production_products_admin
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:22+01:00

CREATE OR REPLACE FUNCTION public.get_production_products_admin()
 RETURNS TABLE(id uuid, name text, slug text, description text, category text, in_stock boolean, stock_quantity integer, price numeric, created_at timestamptz, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Admin or staff access required';
  END IF;
  
  INSERT INTO audit_journal (
    action, user_id, action_type, entity_type, area, severity, summary
  ) VALUES (
    'GET_PRODUCTION_PRODUCTS_ADMIN', auth.uid(), 'read'::journal_action_type, 'products', 
    'production'::journal_area, 'info'::journal_severity,
    'Admin viewed production products'
  );
  
  RETURN QUERY 
  SELECT 
    pr.id, 
    pr.name, 
    pr.slug, 
    COALESCE(pr.description, '') AS description,
    pr.category, 
    COALESCE(pr.in_stock, true) AS in_stock, 
    COALESCE(pr.stock_quantity, 0) AS stock_quantity,
    COALESCE(pr.price, 0) AS price,
    pr.created_at, 
    pr.updated_at
  FROM public.products pr
  ORDER BY pr.name;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_production_products_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_products_admin() TO authenticated;
