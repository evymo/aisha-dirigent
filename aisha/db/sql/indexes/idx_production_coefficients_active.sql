-- Index: idx_production_coefficients_active
CREATE INDEX IF NOT EXISTS idx_production_coefficients_active ON production_coefficients (is_active) WHERE is_active = true;
