-- Function: public.get_batch_inventory_list
-- Arguments: p_product_id uuid, p_status text, p_include_empty boolean
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:40+01:00

CREATE OR REPLACE FUNCTION public.get_batch_inventory_list(p_product_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_include_empty boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_result JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_admin_or_staff(v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT 
      pb.id AS batch_id,
      pb.batch_number,
      pb.product_id,
      p.name AS product_name,
      pb.status AS batch_status,
      pb.total_units,
      pb.available_units,
      pb.total_units - pb.available_units AS assigned_units,
      0 AS shipped_units,
      pb.expiry_date,
      pb.created_at AS batch_created_at,
      pb.quality_approved
    FROM production_batches pb
    JOIN products p ON pb.product_id = p.id
    WHERE (p_product_id IS NULL OR pb.product_id = p_product_id)
      AND (p_status IS NULL OR pb.status = p_status)
      AND (p_include_empty OR pb.available_units > 0)
    ORDER BY pb.expiry_date NULLS LAST, pb.created_at
  ) t;

  INSERT INTO audit_journal (user_id, action_type, area, entity_type, summary, severity)
  VALUES (v_user_id, 'view', 'admin', 'batch_inventory', 'Viewed batch inventory', 'info');

  RETURN v_result;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_batch_inventory_list(p_product_id uuid, p_status text, p_include_empty boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_batch_inventory_list(p_product_id uuid, p_status text, p_include_empty boolean) TO authenticated;
