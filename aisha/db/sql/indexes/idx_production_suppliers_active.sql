-- Index: idx_production_suppliers_active
CREATE INDEX IF NOT EXISTS idx_production_suppliers_active ON production_suppliers (is_active) WHERE is_active = true;
