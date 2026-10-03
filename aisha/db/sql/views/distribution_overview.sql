-- View: public.distribution_overview
-- Description: Distribution forecast summary by product.

CREATE OR REPLACE VIEW public.distribution_overview AS
SELECT
  df.forecast_month,
  df.product_id,
  p.name AS product_name,
  df.production_batch_id,
  df.reserved_packages,
  df.shipped_packages,
  df.status,
  df.total_members,
  df.total_packages_needed
FROM distribution_forecasts df
LEFT JOIN products p ON p.id = df.product_id;
