-- Function: public.upsert_production_material_admin
-- Creates or updates a production material item
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.upsert_production_material_admin(
  p_cas_number text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_id uuid DEFAULT NULL,
  p_is_active boolean DEFAULT true,
  p_item_code text DEFAULT NULL,
  p_item_name text DEFAULT NULL,
  p_item_type text DEFAULT 'RAW',
  p_min_stock_qty numeric DEFAULT NULL,
  p_reorder_point numeric DEFAULT NULL,
  p_shelf_life_days integer DEFAULT NULL,
  p_storage_conditions text DEFAULT NULL,
  p_supplier_default text DEFAULT NULL,
  p_uom text DEFAULT 'kg'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result_id uuid;
  v_action text;
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  IF p_item_code IS NULL OR p_item_name IS NULL THEN
    RAISE EXCEPTION 'item_code and item_name are required';
  END IF;

  IF p_id IS NOT NULL THEN
    v_action := 'update';
    UPDATE public.production_materials SET
      item_code = p_item_code,
      item_name = p_item_name,
      item_type = p_item_type,
      uom = p_uom,
      category = p_category,
      description = p_description,
      cas_number = p_cas_number,
      supplier_default = p_supplier_default,
      min_stock_qty = p_min_stock_qty,
      reorder_point = p_reorder_point,
      shelf_life_days = p_shelf_life_days,
      storage_conditions = p_storage_conditions,
      is_active = p_is_active,
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_result_id;
  ELSE
    v_action := 'create';
    INSERT INTO public.production_materials (
      item_code, item_name, item_type, uom, category, description,
      cas_number, supplier_default, min_stock_qty, reorder_point,
      shelf_life_days, storage_conditions, is_active, created_by
    ) VALUES (
      p_item_code, p_item_name, p_item_type, p_uom, p_category, p_description,
      p_cas_number, p_supplier_default, p_min_stock_qty, p_reorder_point,
      p_shelf_life_days, p_storage_conditions, p_is_active, auth.uid()
    )
    RETURNING id INTO v_result_id;
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := v_action::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := v_result_id::text,
    p_entity_type := 'production_material',
    p_new_values := jsonb_build_object('item_code', p_item_code, 'item_type', p_item_type),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := format('Admin %s production material %s', v_action, p_item_code),
    p_tags := ARRAY['admin', 'production_material'],
    p_user_id := auth.uid()
  );

  RETURN v_result_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_production_material_admin(text, text, text, uuid, boolean, text, text, text, numeric, numeric, integer, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_production_material_admin(text, text, text, uuid, boolean, text, text, text, numeric, numeric, integer, text, text, text) TO authenticated;
