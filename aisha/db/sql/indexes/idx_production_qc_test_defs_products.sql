-- Index: idx_production_qc_test_defs_products
CREATE INDEX IF NOT EXISTS idx_production_qc_test_defs_products ON production_qc_test_definitions USING GIN (applicable_products);
