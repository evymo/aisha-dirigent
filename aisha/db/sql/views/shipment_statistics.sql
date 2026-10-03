-- View: public.shipment_statistics
-- Description: Shipment aggregates by month and status.

CREATE OR REPLACE VIEW public.shipment_statistics AS
SELECT
  sr.distribution_month,
  sr.status,
  COUNT(*)::int4 AS shipment_count,
  SUM(sr.discount_amount) AS total_discounts,
  SUM(sr.full_price) AS total_full_price,
  SUM(sr.final_price) AS total_revenue,
  SUM(sr.tokens_used) AS total_tokens_used
FROM shipment_records sr
GROUP BY sr.distribution_month, sr.status;
