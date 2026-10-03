-- Index: idx_production_coefficients_product_name_key
CREATE UNIQUE INDEX IF NOT EXISTS idx_production_coefficients_product_name_key ON production_coefficients (product, coefficient_name, COALESCE(valid_from, '1900-01-01'::date));
