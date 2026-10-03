-- Function: public.get_production_materials_admin
-- Returns all production materials (master data items)
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.get_production_materials_admin(
  p_category text DEFAULT NULL,
  p_item_type text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  item_code text,
  item_name text,
  item_type text,
  uom text,
  category text,
  description text,
  cas_number text,
  supplier_default text,
  min_stock_qty numeric,
  reorder_point numeric,
  shelf_life_days integer,
  storage_conditions text,
  is_active boolean,
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
    p_entity_type := 'production_material',
    p_new_values := jsonb_build_object('category', p_category, 'item_type', p_item_type),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin read production materials',
    p_tags := ARRAY['admin', 'production_material'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    pm.id, pm.item_code, pm.item_name, pm.item_type,
    pm.uom, pm.category, pm.description, pm.cas_number,
    pm.supplier_default, pm.min_stock_qty, pm.reorder_point,
    pm.shelf_life_days, pm.storage_conditions, pm.is_active,
    pm.created_at, pm.updated_at
  FROM public.production_materials pm
  WHERE (p_category IS NULL OR pm.category = p_category)
    AND (p_item_type IS NULL OR pm.item_type = p_item_type)
  ORDER BY pm.category, pm.item_type, pm.item_code;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_materials_admin(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_materials_admin(text, text) TO authenticated;
