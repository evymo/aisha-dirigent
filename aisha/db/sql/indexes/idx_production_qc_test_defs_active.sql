-- Index: idx_production_qc_test_defs_active
CREATE INDEX IF NOT EXISTS idx_production_qc_test_defs_active ON production_qc_test_definitions (is_active) WHERE is_active = true;
