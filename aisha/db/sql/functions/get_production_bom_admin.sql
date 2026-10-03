-- Function: public.get_production_bom_admin
-- Returns BOM entries with material names for admin
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.get_production_bom_admin(
  p_parent_item_code text DEFAULT NULL,
  p_variant_code text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  parent_item_id uuid,
  parent_item_code text,
  parent_item_name text,
  child_item_id uuid,
  child_item_code text,
  child_item_name text,
  qty_per numeric,
  uom text,
  step_code text,
  variant_code text,
  sort_order integer,
  is_active boolean
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
    p_entity_type := 'production_bom',
    p_new_values := jsonb_build_object('parent_item_code', p_parent_item_code, 'variant_code', p_variant_code),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin read production BOM',
    p_tags := ARRAY['admin', 'production_bom'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    bom.id,
    bom.parent_item_id,
    parent.item_code AS parent_item_code,
    parent.item_name AS parent_item_name,
    bom.child_item_id,
    child.item_code AS child_item_code,
    child.item_name AS child_item_name,
    bom.qty_per,
    bom.uom,
    bom.step_code,
    bom.variant_code,
    bom.sort_order,
    bom.is_active
  FROM public.production_bom_entries bom
  JOIN public.production_materials parent ON parent.id = bom.parent_item_id
  JOIN public.production_materials child ON child.id = bom.child_item_id
  WHERE (p_parent_item_code IS NULL OR parent.item_code = p_parent_item_code)
    AND (p_variant_code IS NULL OR bom.variant_code = p_variant_code)
    AND bom.is_active = true
  ORDER BY parent.item_code, bom.sort_order, child.item_code;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_bom_admin(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_bom_admin(text, text) TO authenticated;
