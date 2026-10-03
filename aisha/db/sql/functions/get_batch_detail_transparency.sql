-- Function: public.get_batch_detail_transparency
-- Description: Returns detailed batch transparency info for a specific production batch.
--   Includes QC status, materials, blockchain verification, protocol steps.
--   Non-sensitive data, member-accessible.
-- Security: SECURITY DEFINER - authenticated batch transparency access.
-- @security: authenticated
-- @audit: none

CREATE OR REPLACE FUNCTION public.get_batch_detail_transparency(p_batch_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_batch RECORD;
  v_product RECORD;
  v_protocol_steps jsonb;
  v_materials jsonb;
  v_topics jsonb;
BEGIN
  -- Get batch info
  SELECT
    pb.id,
    pb.batch_code,
    pb.batch_number,
    pb.product_id,
    pb.status,
    pb.production_date,
    pb.expiry_date,
    pb.quality_approved,
    pb.qc_approved_at,
    pb.qc_notes,
    pb.raw_material_lot,
    pb.supplier_info,
    pb.blockchain_tx_hash,
    pb.blockchain_recorded_at,
    pb.unit,
    pb.total_units,
    pb.available_units,
    pb.released_at,
    pb.content_type,
    pb.purpose,
    pb.projected_yield_percent
  INTO v_batch
  FROM production_batches pb
  WHERE (pb.batch_code = p_batch_code OR pb.batch_number = p_batch_code)
    AND pb.status IN ('released', 'completed');

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Batch not found or not released');
  END IF;

  -- Get product info
  SELECT
    p.name,
    p.slug,
    p.category,
    p.image_url
  INTO v_product
  FROM products p
  WHERE p.id = v_batch.product_id;

  -- Get completed protocol steps (non-sensitive, transparency-only fields)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'step_name', pps.step_name,
      'step_order', pps.step_order,
      'step_type', pps.step_type,
      'description', pps.description,
      'is_completed', pps.is_completed,
      'completed_at', pps.completed_at,
      'status', pps.status
    ) ORDER BY pps.step_order
  ), '[]'::jsonb) INTO v_protocol_steps
  FROM production_protocol_steps pps
  WHERE pps.batch_id = v_batch.id;

  -- Get batch materials (non-sensitive, join to get material names)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'material_name', pm.item_name,
      'item_code', pm.item_code,
      'direction', pbm.direction,
      'planned_qty', pbm.planned_qty,
      'actual_qty', pbm.actual_qty,
      'unit', pbm.uom,
      'lot_number', pl.lot_number
    )
  ), '[]'::jsonb) INTO v_materials
  FROM production_batch_materials pbm
  JOIN production_materials pm ON pm.id = pbm.item_id
  LEFT JOIN production_lots pl ON pl.id = pbm.lot_id
  WHERE pbm.batch_id = v_batch.id
    AND pbm.direction IN ('IN', 'OUT');

  -- Get related knowledge topics (via batch link)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'topic_id', kt.id,
      'slug', kt.slug,
      'title_key', kt.title_key,
      'verification_status', kt.verification_status
    ) ORDER BY ktl.sort_order
  ), '[]'::jsonb) INTO v_topics
  FROM knowledge_topic_links ktl
  JOIN knowledge_topics kt ON kt.id = ktl.topic_id
  WHERE ktl.production_batch_id = v_batch.id
    AND kt.visibility IN ('public', 'members');

  RETURN jsonb_build_object(
    'batch', jsonb_build_object(
      'id', v_batch.id,
      'batch_code', v_batch.batch_code,
      'batch_number', v_batch.batch_number,
      'status', v_batch.status,
      'production_date', v_batch.production_date,
      'expiry_date', v_batch.expiry_date,
      'quality_approved', v_batch.quality_approved,
      'qc_approved_at', v_batch.qc_approved_at,
      'qc_notes', v_batch.qc_notes,
      'raw_material_lot', v_batch.raw_material_lot,
      'supplier_info', v_batch.supplier_info,
      'blockchain_tx_hash', v_batch.blockchain_tx_hash,
      'blockchain_recorded_at', v_batch.blockchain_recorded_at,
      'released_at', v_batch.released_at,
      'content_type', v_batch.content_type,
      'purpose', v_batch.purpose,
      'total_units', v_batch.total_units,
      'available_units', v_batch.available_units,
      'projected_yield_percent', v_batch.projected_yield_percent
    ),
    'product', jsonb_build_object(
      'name', v_product.name,
      'slug', v_product.slug,
      'category', v_product.category,
      'image_url', v_product.image_url
    ),
    'protocol_steps', v_protocol_steps,
    'materials', v_materials,
    'knowledge_topics', v_topics
  );
END;
$function$;

-- Permissions: authenticated only (members can see batch details)
REVOKE ALL ON FUNCTION public.get_batch_detail_transparency(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_batch_detail_transparency(text) TO authenticated;
