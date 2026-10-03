-- View: public.expedition_overview
-- Description: Expedition calendar overview with product and study context.

CREATE OR REPLACE VIEW public.expedition_overview AS
SELECT
  ec.id,
  ec.expedition_date,
  ec.cut_off_date,
  ec.product_id,
  p.name AS product_name,
  ec.study_id,
  s.name AS study_name,
  ec.planned_shipments,
  ec.confirmed_shipments,
  ec.packed_shipments,
  ec.sent_shipments,
  ec.allocated_batches,
  ec.status,
  ec.notes
FROM expedition_calendar ec
LEFT JOIN products p ON p.id = ec.product_id
LEFT JOIN studies s ON s.id = ec.study_id;
