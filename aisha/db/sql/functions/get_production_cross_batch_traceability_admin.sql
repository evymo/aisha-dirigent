-- Function: public.get_production_cross_batch_traceability_admin
-- Arguments: p_batch_id uuid, p_lot_id uuid, p_material_id uuid
-- Description: Cross-batch material traceability. Recursively traces materials through batch chains.
-- Security: SECURITY DEFINER, admin/staff only
-- Source: Migration 20260219180000_production_enhancements.sql

CREATE OR REPLACE FUNCTION public.get_production_cross_batch_traceability_admin(
  p_batch_id uuid DEFAULT NULL,
  p_lot_id uuid DEFAULT NULL,
  p_material_id uuid DEFAULT NULL
)
RETURNS TABLE(
  trace_level integer,
  batch_id uuid,
  batch_code text,
  product_name text,
  batch_status text,
  material_id uuid,
  material_code text,
  material_name text,
  lot_id uuid,
  lot_number text,
  direction text,
  planned_qty numeric,
  actual_qty numeric,
  uom text,
  variance_pct numeric,
  supplier_name text,
  supplier_lot_ref text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  -- Recursive CTE: trace materials through batch chains
  RETURN QUERY
  WITH RECURSIVE material_trace AS (
    -- Base: direct materials of starting batch
    SELECT
      1 AS lvl,
      bm.batch_id,
      pb.batch_code,
      COALESCE(pb.product_name, prod.name) AS prod_name,
      pb.status::text AS b_status,
      bm.item_id AS mat_id,
      pm.item_code AS mat_code,
      pm.item_name AS mat_name,
      bm.lot_id,
      pl.lot_number,
      bm.direction,
      bm.planned_qty,
      bm.actual_qty,
      bm.uom,
      bm.variance_pct,
      ps.supplier_name,
      pl.supplier_lot_reference AS sup_lot_ref
    FROM production_batch_materials bm
    JOIN production_batches pb ON pb.id = bm.batch_id
    LEFT JOIN products prod ON prod.id = pb.product_id
    JOIN production_materials pm ON pm.id = bm.item_id
    LEFT JOIN production_lots pl ON pl.id = bm.lot_id
    LEFT JOIN production_suppliers ps ON ps.id = pl.supplier_id
    WHERE (p_batch_id IS NULL OR bm.batch_id = p_batch_id)
      AND (p_lot_id IS NULL OR bm.lot_id = p_lot_id)
      AND (p_material_id IS NULL OR bm.item_id = p_material_id)

    UNION ALL

    -- Recursive: find batches that consumed outputs of previous batches
    SELECT
      mt.lvl + 1,
      bm2.batch_id,
      pb2.batch_code,
      COALESCE(pb2.product_name, prod2.name),
      pb2.status::text,
      bm2.item_id,
      pm2.item_code,
      pm2.item_name,
      bm2.lot_id,
      pl2.lot_number,
      bm2.direction,
      bm2.planned_qty,
      bm2.actual_qty,
      bm2.uom,
      bm2.variance_pct,
      ps2.supplier_name,
      pl2.supplier_lot_reference
    FROM material_trace mt
    JOIN production_batch_materials bm2
      ON bm2.lot_id = mt.lot_id AND bm2.batch_id <> mt.batch_id
    JOIN production_batches pb2 ON pb2.id = bm2.batch_id
    LEFT JOIN products prod2 ON prod2.id = pb2.product_id
    JOIN production_materials pm2 ON pm2.id = bm2.item_id
    LEFT JOIN production_lots pl2 ON pl2.id = bm2.lot_id
    LEFT JOIN production_suppliers ps2 ON ps2.id = pl2.supplier_id
    WHERE mt.lvl < 10 -- Max recursion depth
      AND mt.direction IN ('OUT', 'BYPRODUCT') -- Only trace outputs
  )
  SELECT
    mt.lvl, mt.batch_id, mt.batch_code, mt.prod_name, mt.b_status,
    mt.mat_id, mt.mat_code, mt.mat_name, mt.lot_id, mt.lot_number,
    mt.direction, mt.planned_qty, mt.actual_qty, mt.uom, mt.variance_pct,
    mt.supplier_name, mt.sup_lot_ref
  FROM material_trace mt
  ORDER BY mt.lvl, mt.batch_code, mt.mat_code;
END;
$$;

REVOKE ALL ON FUNCTION public.get_production_cross_batch_traceability_admin(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_cross_batch_traceability_admin(uuid, uuid, uuid) TO authenticated;
