-- View: public.batch_inventory_overview
-- Description: Inventory summary for production batches.

CREATE OR REPLACE VIEW public.batch_inventory_overview AS
SELECT
  pb.id AS batch_id,
  pb.batch_number,
  pb.status AS batch_status,
  pb.created_at AS batch_created_at,
  pb.completed_at AS batch_completed_at,
  pb.product_id,
  COALESCE(pb.product_name, p.name) AS product_name,
  pb.total_units,
  pb.available_units,
  CASE
    WHEN pb.total_units IS NULL OR pb.available_units IS NULL THEN NULL
    ELSE pb.total_units - pb.available_units
  END AS used_units,
  NULL::int4 AS assigned_units,
  NULL::int4 AS shipped_units,
  pb.quality_approved,
  pb.expiry_date
FROM production_batches pb
LEFT JOIN products p ON p.id = pb.product_id;
